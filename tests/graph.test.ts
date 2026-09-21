import { describe, expect, test } from "bun:test";
import type { Person, Referral } from "../src/domain/types.ts";
import { buildReferralGraph, referredBy, referrersOf } from "../src/graph/referralGraph.ts";
import { CURRENT_SPECS, REFERRAL_SIGNAL_V0_1_0 } from "../src/models/registry.ts";
import {
  computeAllReferralSignals,
  type ReferralSignalResult,
} from "../src/scoring/referralSignal.ts";
import { referralStrength } from "../src/scoring/referralStrength.ts";
import { scoreReferralGraph, toEdgeList } from "../src/scoring/scoredGraph.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");

function person(id: string, overrides: Partial<Person> = {}): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0, ...overrides };
}

function referral(from: string, to: string, overrides: Partial<Referral> = {}): Referral {
  return {
    id: `${from}->${to}`,
    referrerId: from,
    candidateId: to,
    conviction: 4,
    confidence: 3,
    relationshipDepth: 3,
    evidenceType: "firsthand_work",
    evidenceText: "Saw it happen.",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

// a → b → c → d, a → c, e isolated
const people = [
  person("a", { status: "member", affiliation: "X" }),
  person("b", { affiliation: "X" }),
  person("c", { affiliation: "Y" }),
  person("d"),
  person("e", { status: "archived" }),
];
const referrals = [
  referral("a", "b"),
  referral("b", "c", { evidenceType: "reputation" }),
  referral("c", "d", { evidenceType: "artifact" }),
  referral("a", "c", { conviction: 5 }),
];
const g = buildReferralGraph(people, referrals);

describe("referral graph", () => {
  test("referrersOf / referredBy", () => {
    expect(referrersOf(g, "c").map((p) => p.id)).toEqual(["b", "a"]);
    expect(referredBy(g, "a").map((p) => p.id)).toEqual(["b", "c"]);
  });

  // `toEdgeList` moved to scoring/scoredGraph.ts in #56 T3: the weight is a
  // score, so it takes a ScoredReferralGraph. Same R_uv, same order.
  test("edge weights equal referralStrength", () => {
    const edges = toEdgeList(scoreReferralGraph(people, referrals, CURRENT_SPECS.referral_signal));
    expect(edges).toHaveLength(4);
    expect(edges.map((e) => `${e.source}->${e.target}`)).toEqual(["a->b", "a->c", "b->c", "c->d"]);
    for (const e of edges) {
      const r = referrals.find((x) => x.referrerId === e.source && x.candidateId === e.target);
      expect(e.weight).toBe(referralStrength(r as Referral));
    }
  });

  test("toEdgeList scores with the supplied spec, not always the current one", () => {
    const historical = {
      ...REFERRAL_SIGNAL_V0_1_0,
      version: "0.0.1",
      evidenceMultiplier: { ...REFERRAL_SIGNAL_V0_1_0.evidenceMultiplier, firsthand_work: 0.1 },
    };
    const current = toEdgeList(
      scoreReferralGraph(people, referrals, CURRENT_SPECS.referral_signal),
    );
    const old = toEdgeList(scoreReferralGraph(people, referrals, historical));
    expect(old).toHaveLength(current.length);
    const key = (e: { source: string; target: string }) => `${e.source}->${e.target}`;
    for (const e of old) {
      const r = referrals.find((x) => key(e) === `${x.referrerId}->${x.candidateId}`) as Referral;
      expect(e.weight).toBe(referralStrength(r, historical));
      const c = current.find((x) => key(x) === key(e)) as { weight: number };
      if (r.evidenceType === "firsthand_work") {
        expect(e.weight).not.toBe(c.weight);
        expect(e.weight).toBeCloseTo(c.weight * 0.1, 12);
      } else {
        expect(e.weight).toBe(c.weight);
      }
    }
    expect(old.some((e, i) => e.weight !== current[i]?.weight)).toBe(true);
  });

  test("referrals with unknown endpoints are dropped", () => {
    const extra = [...referrals, referral("ghost", "a")];
    const h = buildReferralGraph(people, extra);
    expect(h.in.get("a")?.length ?? 0).toBe(0);

    // `toEdgeList` emits the closed graph only, so the dangling edge is scored
    // (it is in `dangling`) but never becomes an edge.
    const sg = scoreReferralGraph(people, extra, CURRENT_SPECS.referral_signal);
    expect(sg.dangling.map((e) => e.referral.id)).toEqual(["ghost->a"]);
    expect(toEdgeList(sg).map((e) => `${e.source}->${e.target}`)).toEqual([
      "a->b",
      "a->c",
      "b->c",
      "c->d",
    ]);
  });

  // #56 T1. The graph and the scorer apply different edge-admission rules:
  // buildReferralGraph drops a referral whose referrer OR candidate is unknown,
  // while computeAllReferralSignals drops only self-referrals — so a referral
  // from a person who is not in `people` is scored but has no edge. This pins
  // that divergence as it stands today; it is not an endorsement of it.
  test("scoring scores dangling referrals; the graph drops them — V0 behaviour, pinned", () => {
    const pair = [person("a"), person("b")];
    const strong: Partial<Referral> = {
      conviction: 5,
      confidence: 5,
      relationshipDepth: 5,
      evidenceType: "firsthand_work",
    };
    const edges = [referral("b", "a", strong), referral("ghost", "a", strong)];

    const h = buildReferralGraph(pair, edges);
    const signals = computeAllReferralSignals(pair, edges);
    const a = signals.get("a") as ReferralSignalResult;

    // The graph admits only b → a; ghost is not a node, so its edge vanishes.
    expect(h.in.get("a")?.length ?? 0).toBe(1);
    expect(referrersOf(h, "a").map((p) => p.id)).toEqual(["b"]);
    expect(toEdgeList(scoreReferralGraph(pair, edges, REFERRAL_SIGNAL_V0_1_0))).toHaveLength(1);

    // The scorer counts both, including the one from the unknown referrer.
    expect(a.incomingCount).toBe(2);
    expect(a.usedCount).toBe(2);
    expect(a.signal).toBe(100);
    expect(a.contributing.map((c) => c.referral.referrerId).sort()).toEqual(["b", "ghost"]);

    // The divergence itself, stated once.
    expect(a.incomingCount).not.toBe(h.in.get("a")?.length ?? 0);
  });

  // #56 T1, the other half: an unknown *candidate* does not diverge. Both
  // sides drop it — the graph has no node to hang the edge on, and the scorer
  // only ever reports people it was given. Only the unknown-referrer case
  // above is asymmetric.
  test("an unknown candidate diverges in neither direction — V0 behaviour, pinned", () => {
    const pair = [person("a"), person("b")];
    const edges = [referral("a", "phantom")];

    const h = buildReferralGraph(pair, edges);
    expect(toEdgeList(h)).toHaveLength(0);
    expect(inDegree(h, "phantom")).toBe(0);
    expect(outDegree(h, "a")).toBe(0);

    const signals = computeAllReferralSignals(pair, edges);
    expect(signals.has("phantom")).toBe(false);
    expect((signals.get("a") as ReferralSignalResult).incomingCount).toBe(0);
  });
});
