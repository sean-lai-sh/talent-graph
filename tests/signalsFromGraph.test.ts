/**
 * `computeSignalsFromGraph` — signals read the shared scored index (issue #56, T5).
 *
 * The whole acceptance criterion is that no number moves: `computeAllReferralSignals`
 * is now `scoreReferralGraph(...)` → `computeSignalsFromGraph(...)`, and it must
 * agree, field for field and bit for bit, with the V0 computation it replaced —
 * the per-person `computeReferralSignal` over the raw referral array.
 *
 * Every spec here is passed explicitly (`REFERRAL_SIGNAL_V0_1_0`); nothing in
 * this file depends on `process.env` or on whichever spec happens to be current.
 */

import { describe, expect, test } from "bun:test";
import type { Person, Referral } from "../src/domain/types.ts";
import { REFERRAL_SIGNAL_V0_1_0 } from "../src/models/registry.ts";
import {
  computeAllReferralSignals,
  computeReferralSignal,
  computeSignalsFromGraph,
  type ReferralSignalResult,
} from "../src/scoring/referralSignal.ts";
import { scoreReferralGraph } from "../src/scoring/scoredGraph.ts";
import { judgeWeighting } from "../src/scoring/weighting.ts";
import { generateSeed } from "../src/seed/generate.ts";

const SPEC = REFERRAL_SIGNAL_V0_1_0;
const T0 = new Date("2026-01-01T00:00:00.000Z");
let seq = 0;

function person(id: string): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0 };
}

function referral(referrerId: string, candidateId: string, over: Partial<Referral> = {}): Referral {
  seq++;
  return {
    id: `r-${seq}`,
    referrerId,
    candidateId,
    conviction: 4,
    confidence: 4,
    relationshipDepth: 3,
    evidenceType: "firsthand_work",
    evidenceText: "Worked with them directly on a hard problem.",
    createdAt: new Date(T0.getTime() + seq * 86_400_000),
    updatedAt: T0,
    ...over,
  };
}

/**
 * Byte-level comparison. `JSON.stringify` round-trips a double exactly and
 * writes Dates as ISO strings, so two results serialising to the same text are
 * equal down to the last bit of every score — a `toBeCloseTo` would hide
 * exactly the reordering-of-the-mean risk this ticket is about.
 */
function frozen(r: ReferralSignalResult): string {
  return JSON.stringify(r);
}

function frozenMap(m: ReadonlyMap<string, ReferralSignalResult>): string {
  return JSON.stringify([...m.entries()].map(([id, r]) => [id, frozen(r)]));
}

/** The pre-T5 implementation, by hand: one `computeReferralSignal` per person. */
function v0ByHand(
  people: readonly Person[],
  referrals: readonly Referral[],
  opts: Parameters<typeof computeReferralSignal>[2] = {},
): Map<string, ReferralSignalResult> {
  const out = new Map<string, ReferralSignalResult>();
  for (const p of people) out.set(p.id, computeReferralSignal(p.id, referrals, opts));
  return out;
}

describe("computeAllReferralSignals via the shared index reproduces V0 exactly", () => {
  test("the dangling-edge fixture [b→a, ghost→a] is byte-identical to the hand-rolled V0", () => {
    const people = [person("a"), person("b")];
    const strong: Partial<Referral> = {
      conviction: 5,
      confidence: 5,
      relationshipDepth: 5,
      evidenceType: "firsthand_work",
    };
    const referrals = [referral("b", "a", strong), referral("ghost", "a", strong)];

    const viaGraph = computeAllReferralSignals(people, referrals, { spec: SPEC });
    expect(frozenMap(viaGraph)).toBe(frozenMap(v0ByHand(people, referrals, { spec: SPEC })));

    // And the divergence T1 pinned survives: the unknown referrer is still
    // scored evidence even though the closed graph has no such edge.
    const a = viaGraph.get("a") as ReferralSignalResult;
    expect(a.incomingCount).toBe(2);
    expect(a.usedCount).toBe(2);
    expect(a.signal).toBe(100);
    expect(a.contributing.map((c) => c.referral.referrerId).sort()).toEqual(["b", "ghost"]);
  });

  test("the ghost candidate keys `sg.in` but never the result map", () => {
    const people = [person("a")];
    const referrals = [referral("a", "ghost"), referral("ghost", "a")];
    const sg = scoreReferralGraph(people, referrals, SPEC);

    expect([...sg.in.keys()].sort()).toEqual(["a", "ghost"]);
    // Results cover `people`, and only them — a non-person gets no score row.
    expect([...computeSignalsFromGraph(sg).keys()]).toEqual(["a"]);
    expect([...computeAllReferralSignals(people, referrals, { spec: SPEC }).keys()]).toEqual(["a"]);
  });

  test("the seed is byte-identical to the hand-rolled V0, person for person", () => {
    const seed = generateSeed();
    const viaGraph = computeAllReferralSignals(seed.people, seed.referrals, { spec: SPEC });
    const byHand = v0ByHand(seed.people, seed.referrals, { spec: SPEC });
    expect([...viaGraph.keys()]).toEqual([...byHand.keys()]);
    for (const [id, r] of viaGraph) {
      expect(frozen(r)).toBe(frozen(byHand.get(id) as ReferralSignalResult));
    }
  });

  test("a V2 judge weighting takes the same path and the same numbers", () => {
    const people = [person("a"), person("b"), person("c")];
    const referrals = [
      referral("b", "a", { conviction: 5 }),
      referral("c", "a", { conviction: 2 }),
      referral("a", "b"),
    ];
    const weighting = judgeWeighting({
      reliability: new Map([
        ["b", 0.5],
        ["c", 0],
      ]),
      bias: new Map([["b", 0.1]]),
    });
    expect(frozenMap(computeAllReferralSignals(people, referrals, { spec: SPEC, weighting }))).toBe(
      frozenMap(v0ByHand(people, referrals, { spec: SPEC, weighting })),
    );
    // The ineligible judge is still kept out of Top-K, not zero-weighted into it.
    const a = computeAllReferralSignals(people, referrals, { spec: SPEC, weighting }).get(
      "a",
    ) as ReferralSignalResult;
    expect(a.incomingCount).toBe(2);
    expect(a.usedCount).toBe(1);
    expect(a.judgeWeighted).toBe(true);
  });
});

describe("computeSignalsFromGraph", () => {
  test("absence stays absence: no incoming edges ⇒ null strongest, no fabricated 0 score", () => {
    const people = [person("a"), person("lonely")];
    const sg = scoreReferralGraph(people, [referral("lonely", "a")], SPEC);
    const lonely = computeSignalsFromGraph(sg).get("lonely") as ReferralSignalResult;

    expect(lonely.strongest).toBeNull();
    expect(lonely.incomingCount).toBe(0);
    expect(lonely.usedCount).toBe(0);
    expect(lonely.firsthandCount).toBe(0);
    expect(lonely.contributing).toEqual([]);
    expect(lonely.evidenceTypes).toEqual([]);
    expect(lonely.s).toBe(0);
    // Same shape as the path that never saw a graph at all.
    expect(frozen(lonely)).toBe(frozen(computeReferralSignal("lonely", [], { spec: SPEC })));
  });

  test("the spec is the index's own: version stamp and topK come from `sg`, not a default", () => {
    const tight = { ...SPEC, version: "0.9.5", topK: 1 };
    const people = [person("a"), person("b"), person("c")];
    const referrals = [
      referral("b", "a", { conviction: 5 }),
      referral("c", "a", { conviction: 2 }),
    ];
    const a = computeSignalsFromGraph(scoreReferralGraph(people, referrals, tight)).get(
      "a",
    ) as ReferralSignalResult;

    expect(a.specVersion).toBe("0.9.5");
    expect(a.incomingCount).toBe(2);
    expect(a.usedCount).toBe(1);
    // An explicit override still beats the spec's topK, as on the other paths.
    expect(
      (
        computeSignalsFromGraph(scoreReferralGraph(people, referrals, tight), { topK: 2 }).get(
          "a",
        ) as ReferralSignalResult
      ).usedCount,
    ).toBe(2);
  });

  test("self-referrals never contribute, exactly as in V0", () => {
    const people = [person("a"), person("b")];
    const self = referral("a", "a", { conviction: 5 });
    const real = referral("b", "a", { conviction: 2 });
    const sg = scoreReferralGraph(people, [self, real], SPEC);
    const a = computeSignalsFromGraph(sg).get("a") as ReferralSignalResult;

    expect(a.incomingCount).toBe(1);
    expect(a.contributing.map((c) => c.referral.id)).toEqual([real.id]);
    expect(frozen(a)).toBe(frozen(computeReferralSignal("a", [self, real], { spec: SPEC })));
  });

  test("`sg.in` keeps the input order the tie-break falls through to", () => {
    // Three identical-strength, identical-timestamp referrals, deliberately not
    // in id order: `compareContributing` resolves the tie, and anything it
    // cannot separate falls through to the order of the referral array — so the
    // index must hand the edges over in that order and both paths must agree.
    const at = new Date(T0.getTime() + 5 * 86_400_000);
    const people = [person("a"), person("x"), person("y"), person("z")];
    const referrals = [
      referral("x", "a", { id: "r-mid", createdAt: at }),
      referral("y", "a", { id: "r-aaa", createdAt: at }),
      referral("z", "a", { id: "r-zzz", createdAt: at }),
    ];
    const sg = scoreReferralGraph(people, referrals, SPEC);
    expect(sg.in.get("a")?.map((e) => e.referral.id)).toEqual(["r-mid", "r-aaa", "r-zzz"]);

    const a = computeAllReferralSignals(people, referrals, { spec: SPEC }).get(
      "a",
    ) as ReferralSignalResult;
    expect(a.contributing.map((c) => c.referral.id)).toEqual(
      computeReferralSignal("a", referrals, { spec: SPEC }).contributing.map((c) => c.referral.id),
    );
  });
});
