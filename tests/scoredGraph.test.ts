/**
 * `scoreReferralGraph` — the single scored index (issue #56, T2).
 *
 * The point of these tests is that the index reproduces V0 exactly: same
 * strengths, same order, same admission rules. Nothing consumes the module
 * yet, so anything asserted here is the whole contract.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Person, Referral } from "../src/domain/types.ts";
import { buildReferralGraph } from "../src/graph/referralGraph.ts";
import { REFERRAL_SIGNAL_V0_1_0 } from "../src/models/registry.ts";
import { computeReferralSignal } from "../src/scoring/referralSignal.ts";
import { referralStrength } from "../src/scoring/referralStrength.ts";
import { scoreReferralGraph } from "../src/scoring/scoredGraph.ts";
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

describe("scoreReferralGraph: the seed", () => {
  const seed = generateSeed();
  const sg = scoreReferralGraph(seed.people, seed.referrals, SPEC);

  test("sg.in strengths equal the V0 per-candidate strengths element-for-element", () => {
    let checked = 0;
    for (const p of seed.people) {
      const expected = seed.referrals
        .filter((r) => r.candidateId === p.id)
        .map((r) => referralStrength(r, SPEC));
      const actual = (sg.in.get(p.id) ?? []).map((e) => e.strength);
      expect(actual).toEqual(expected);
      checked += expected.length;
    }
    expect(checked).toBe(seed.referrals.length);
  });

  test("sg.graph deep-equals buildReferralGraph(people, referrals)", () => {
    expect(sg.graph).toEqual(buildReferralGraph(seed.people, seed.referrals));
  });

  test("sg.dangling is empty on the seed, and every edge is indexed once", () => {
    expect(sg.dangling).toEqual([]);
    expect(sg.byReferralId.size).toBe(seed.referrals.length);
    for (const edge of sg.byReferralId.values()) expect(edge.dangling).toBe(false);
    expect(sg.specVersion).toBe(SPEC.version);
    expect(sg.policy).toBe("score");
  });

  test("absence stays absence: no incoming means an empty list, never a 0 score", () => {
    const empty = seed.people.filter((p) => (sg.in.get(p.id) ?? []).length === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const p of empty) {
      expect(sg.in.get(p.id)).toEqual([]);
      expect(computeReferralSignal(p.id, seed.referrals, { spec: SPEC }).strongest).toBeNull();
    }
  });

  test("sg.out mirrors the same edges, in input order, keyed by referrer", () => {
    for (const p of seed.people) {
      const expected = seed.referrals.filter((r) => r.referrerId === p.id).map((r) => r.id);
      expect((sg.out.get(p.id) ?? []).map((e) => e.referral.id)).toEqual(expected);
    }
  });
});

describe("scoreReferralGraph: the T1 golden fixture", () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures", "referral-golden.json"), "utf8"),
  ) as {
    view: Record<string, { referralStrength: Record<string, number> }>;
  };
  const seed = generateSeed();
  const sg = scoreReferralGraph(seed.people, seed.referrals, SPEC);

  test("sg.in strengths match the pinned per-referral strengths element-for-element", () => {
    let checked = 0;
    for (const [personId, row] of Object.entries(fixture.view)) {
      const edges = sg.in.get(personId) ?? [];
      // The fixture's map is keyed by referral id; walk sg.in in its own order
      // so an ordering change here is as visible as a numeric one.
      const ids = edges.map((e) => e.referral.id);
      expect([...ids].sort()).toEqual(Object.keys(row.referralStrength).sort());
      for (const edge of edges) {
        expect(edge.strength).toBe(row.referralStrength[edge.referral.id] as number);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("every edge's strength is exactly referralStrength(referral, spec)", () => {
    for (const edge of sg.byReferralId.values()) {
      expect(edge.strength).toBe(referralStrength(edge.referral, SPEC));
      expect(edge.strength).toBe(edge.breakdown.strength);
    }
  });
});

describe("scoreReferralGraph: dangling policy", () => {
  const people = [person("a"), person("b")];
  const strong: Partial<Referral> = {
    conviction: 5,
    confidence: 5,
    relationshipDepth: 5,
    evidenceType: "firsthand_work",
  };
  const fromB = referral("b", "a", strong);
  const fromGhost = referral("ghost", "a", strong);
  const referrals = [fromB, fromGhost];

  test("default 'score' keeps the dangling edge in sg.in, matching V0", () => {
    const sg = scoreReferralGraph(people, referrals, SPEC);
    expect(sg.policy).toBe("score");
    expect((sg.in.get("a") ?? []).map((e) => e.referral.id)).toEqual([fromB.id, fromGhost.id]);
    expect(sg.dangling.map((e) => e.referral.id)).toEqual([fromGhost.id]);
    expect(sg.byReferralId.get(fromGhost.id)?.dangling).toBe(true);
    // The unknown referrer is keyed in `out` even though it is not a node.
    expect((sg.out.get("ghost") ?? []).map((e) => e.referral.id)).toEqual([fromGhost.id]);
    // …but the closed adjacency still drops it.
    expect(sg.graph.nodes.has("ghost")).toBe(false);
    expect(sg.graph.in.get("a")).toEqual([fromB]);

    // V0 agreement: both referrals score for "a".
    const v0 = computeReferralSignal("a", referrals, { spec: SPEC });
    expect((sg.in.get("a") ?? []).length).toBe(v0.incomingCount);
  });

  test("'drop' removes the dangling edge from sg.in and sg.out, keeping it scored", () => {
    const sg = scoreReferralGraph(people, referrals, SPEC, { dangling: "drop" });
    expect(sg.policy).toBe("drop");
    expect((sg.in.get("a") ?? []).map((e) => e.referral.id)).toEqual([fromB.id]);
    expect(sg.out.get("ghost")).toBeUndefined();
    // Still scored and still reported — "drop" hides the edge, it never erases it.
    expect(sg.dangling.map((e) => e.referral.id)).toEqual([fromGhost.id]);
    expect(sg.byReferralId.get(fromGhost.id)?.strength).toBe(referralStrength(fromGhost, SPEC));
    expect(sg.graph).toEqual(buildReferralGraph(people, referrals));
  });
});

describe("scoreReferralGraph: self-referrals and ordering", () => {
  test("a self-referral is scored and indexed but is never incoming or outgoing", () => {
    const people = [person("a"), person("b")];
    const self = referral("a", "a");
    const real = referral("b", "a");
    const sg = scoreReferralGraph(people, [self, real], SPEC);

    expect((sg.in.get("a") ?? []).map((e) => e.referral.id)).toEqual([real.id]);
    expect(sg.out.get("a")).toEqual([]);
    expect(sg.byReferralId.get(self.id)?.strength).toBe(referralStrength(self, SPEC));
    expect(sg.dangling).toEqual([]);

    // Exactly V0: computeReferralSignal drops the self-referral too.
    const v0 = computeReferralSignal("a", [self, real], { spec: SPEC });
    expect(v0.incomingCount).toBe(1);
    expect((sg.in.get("a") ?? []).map((e) => e.strength)).toEqual(
      v0.contributing.map((c) => c.breakdown.strength),
    );
  });

  test("sg.in preserves input order for ties, which V0's tie-break depends on", () => {
    const people = [person("a"), person("b"), person("c"), person("d")];
    // Identical strength, identical createdAt: only input order separates them.
    const same = { createdAt: T0, conviction: 4, confidence: 4, relationshipDepth: 3 } as const;
    const first = referral("d", "a", { ...same, id: "r-zz" });
    const second = referral("c", "a", { ...same, id: "r-aa" });
    const third = referral("b", "a", { ...same, id: "r-mm" });
    const sg = scoreReferralGraph(people, [first, second, third], SPEC);

    const strengths = (sg.in.get("a") ?? []).map((e) => e.strength);
    expect(new Set(strengths).size).toBe(1);
    expect((sg.in.get("a") ?? []).map((e) => e.referral.id)).toEqual(["r-zz", "r-aa", "r-mm"]);
    // Not the id order a sort would produce.
    expect((sg.in.get("a") ?? []).map((e) => e.referral.id)).not.toEqual(["r-aa", "r-mm", "r-zz"]);
  });
});
