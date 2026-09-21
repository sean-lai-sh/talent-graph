import { describe, expect, test } from "bun:test";
import type { Person, Referral } from "../src/domain/types.ts";
import { REFERRAL_SIGNAL_V0_1_0 } from "../src/models/registry.ts";
import { computeAllReferralSignals, computeReferralSignal } from "../src/scoring/referralSignal.ts";
import { referralStrengthBreakdown } from "../src/scoring/referralStrength.ts";
import type { ScoredEdge } from "../src/scoring/scoredGraph.ts";
import {
  composeWeightings,
  type EdgeWeighting,
  IDENTITY_WEIGHTING,
  judgeWeighting,
} from "../src/scoring/weighting.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
let seq = 0;

function referral(overrides: Partial<Referral> = {}): Referral {
  seq++;
  return {
    id: `r-${seq}`,
    referrerId: `u-${seq}`,
    candidateId: "v",
    conviction: 5,
    confidence: 4,
    relationshipDepth: 3,
    evidenceType: "firsthand_work",
    evidenceText: "Watched them ship a hard thing.",
    createdAt: new Date(T0.getTime() + seq * 86_400_000),
    updatedAt: T0,
    ...overrides,
  };
}

function person(id: string): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0 };
}

function edgeOf(r: Referral): ScoredEdge {
  const breakdown = referralStrengthBreakdown(r, REFERRAL_SIGNAL_V0_1_0);
  return { referral: r, strength: breakdown.strength, breakdown, dangling: false };
}

describe("IDENTITY_WEIGHTING", () => {
  test("is the V0 path: contribution is R_uv, always eligible, not weighted", () => {
    const edge = edgeOf(referral());
    const w = IDENTITY_WEIGHTING.weigh(edge);
    expect(IDENTITY_WEIGHTING.kind).toBe("identity");
    expect(IDENTITY_WEIGHTING.weighted).toBe(false);
    expect(w.contribution).toBe(edge.strength);
    expect(w.eligible).toBe(true);
    expect(w.factors).toEqual({ reliability: 1, bias: 0, adjusted: edge.strength });
  });
});

describe("judgeWeighting", () => {
  test("is p_u * clip(R_uv - b_u, 0, 1) and reports the intermediates", () => {
    const r = referral({ referrerId: "j" });
    const edge = edgeOf(r);
    const w = judgeWeighting({
      reliability: new Map([["j", 0.5]]),
      bias: new Map([["j", 0.1]]),
    }).weigh(edge);
    const adjusted = edge.strength - 0.1;
    expect(w.factors.adjusted).toBe(adjusted);
    expect(w.contribution).toBe(0.5 * adjusted);
    expect(w.eligible).toBe(true);
    expect(w.factors.reliability).toBe(0.5);
    expect(w.factors.bias).toBe(0.1);
  });

  test("a judge absent from the maps is neutral, not zero", () => {
    const edge = edgeOf(referral({ referrerId: "unknown" }));
    const w = judgeWeighting({ reliability: new Map([["other", 0]]) }).weigh(edge);
    expect(w.contribution).toBe(edge.strength);
    expect(w.eligible).toBe(true);
    expect(w.factors.reliability).toBe(1);
  });

  test("a zero-reliability judge is ineligible rather than a zero contribution slot", () => {
    const edge = edgeOf(referral({ referrerId: "bad" }));
    const w = judgeWeighting({ reliability: new Map([["bad", 0]]) }).weigh(edge);
    expect(w.eligible).toBe(false);
    expect(w.contribution).toBe(0);
  });

  test("reliability outside [0,1] and a non-finite bias throw", () => {
    const edge = edgeOf(referral({ referrerId: "j" }));
    expect(() => judgeWeighting({ reliability: new Map([["j", 1.5]]) }).weigh(edge)).toThrow(
      /reliability/,
    );
    expect(() => judgeWeighting({ reliability: new Map([["j", -0.1]]) }).weigh(edge)).toThrow(
      /reliability/,
    );
    expect(() => judgeWeighting({ bias: new Map([["j", Number.NaN]]) }).weigh(edge)).toThrow(
      /bias/,
    );
  });

  test("the bias clip is bounded to [0,1]", () => {
    const edge = edgeOf(referral({ referrerId: "j" }));
    expect(judgeWeighting({ bias: new Map([["j", 5]]) }).weigh(edge).contribution).toBe(0);
    expect(judgeWeighting({ bias: new Map([["j", -5]]) }).weigh(edge).contribution).toBe(1);
  });
});

describe("composeWeightings", () => {
  const edges = [
    edgeOf(referral({ referrerId: "j" })),
    edgeOf(referral({ referrerId: "j", conviction: 2, confidence: 2, relationshipDepth: 1 })),
    edgeOf(referral({ referrerId: "zero" })),
  ];

  test("no arguments is the identity; one argument is that weighting unchanged", () => {
    expect(composeWeightings()).toBe(IDENTITY_WEIGHTING);
    const jw = judgeWeighting({ reliability: new Map([["j", 0.4]]) });
    expect(composeWeightings(jw)).toBe(jw);
  });

  test("identity o identity is the identity result", () => {
    const composed = composeWeightings(IDENTITY_WEIGHTING, IDENTITY_WEIGHTING);
    expect(composed.weighted).toBe(false);
    for (const edge of edges) {
      const a = composed.weigh(edge);
      const b = IDENTITY_WEIGHTING.weigh(edge);
      expect(a.contribution).toBe(b.contribution);
      expect(a.eligible).toBe(b.eligible);
      // `factors` is a superset: the plain keys match, plus prefixed provenance.
      expect(a.factors.reliability).toBe(1);
      expect(a.factors.bias).toBe(0);
      expect(a.factors.adjusted).toBe(edge.strength);
    }
  });

  test("identity o judge equals judge alone, bit for bit", () => {
    const jw = judgeWeighting({
      reliability: new Map([
        ["j", 0.4],
        ["zero", 0],
      ]),
      bias: new Map([["j", 0.05]]),
    });
    const composed = composeWeightings(IDENTITY_WEIGHTING, jw);
    expect(composed.weighted).toBe(true);
    for (const edge of edges) {
      const a = composed.weigh(edge);
      const b = jw.weigh(edge);
      expect(a.contribution).toBe(b.contribution);
      expect(a.eligible).toBe(b.eligible);
      // `factors` is a superset: the plain keys match, plus prefixed provenance.
      expect(a.factors.reliability).toBe(b.factors.reliability as number);
      expect(a.factors.bias).toBe(b.factors.bias as number);
      expect(a.factors.adjusted).toBe(b.factors.adjusted as number);
      expect(a.factors["judge_v2.adjusted"]).toBe(b.factors.adjusted as number);
    }
  });

  test("eligibility is AND and weighted is OR across the pipeline", () => {
    const veto: EdgeWeighting = {
      kind: "veto",
      weighted: false,
      weigh: () => ({ contribution: 0, eligible: false, factors: {} }),
    };
    const composed = composeWeightings(IDENTITY_WEIGHTING, veto);
    expect(composed.weighted).toBe(false);
    expect(composed.weigh(edges[0] as ScoredEdge).eligible).toBe(false);
    expect(composeWeightings(veto, judgeWeighting({})).weighted).toBe(true);
    expect(composed.kind).toBe("compose(identity,veto)");
  });

  test("a later stage sees the earlier stage's contribution as the strength", () => {
    const half: EdgeWeighting = {
      kind: "half",
      weighted: true,
      weigh: (e) => ({ contribution: e.strength / 2, eligible: true, factors: {} }),
    };
    const edge = edges[0] as ScoredEdge;
    const composed = composeWeightings(half, half);
    expect(composed.weigh(edge).contribution).toBe(edge.strength / 4);
  });
});

describe("computeReferralSignal routed through a weighting", () => {
  const people = [person("v")];

  test("no options is IDENTITY_WEIGHTING: unweighted and judge neutral", () => {
    const rs = [referral(), referral({ conviction: 3 })];
    const res = computeReferralSignal("v", rs);
    expect(res.judgeWeighted).toBe(false);
    for (const c of res.contributing) {
      expect(c.strength).toBe(c.breakdown.strength);
      expect(c.judge).toEqual({ reliability: 1, bias: 0, adjusted: c.breakdown.strength });
    }
  });

  test("an explicit IDENTITY_WEIGHTING is identical to passing nothing", () => {
    const rs = [referral(), referral({ conviction: 2 })];
    expect(computeReferralSignal("v", rs, { weighting: IDENTITY_WEIGHTING })).toEqual(
      computeReferralSignal("v", rs),
    );
  });

  test("an explicit judgeWeighting is identical to the judgeReliability sugar", () => {
    const rs = [referral({ referrerId: "a" }), referral({ referrerId: "b" })];
    const reliability = new Map([
      ["a", 0.75],
      ["b", 0.25],
    ]);
    const bias = new Map([["a", 0.1]]);
    const viaSugar = computeAllReferralSignals(people, rs, {
      judgeReliability: reliability,
      judgeBias: bias,
    });
    const viaStrategy = computeAllReferralSignals(people, rs, {
      weighting: judgeWeighting({ reliability, bias }),
    });
    expect(viaStrategy.get("v")).toEqual(viaSugar.get("v") as never);
    expect(viaStrategy.get("v")?.judgeWeighted).toBe(true);
  });

  test("passing both a weighting and the judge sugar throws instead of weighting twice", () => {
    const rs = [referral({ referrerId: "a" })];
    expect(() =>
      computeReferralSignal("v", rs, {
        weighting: IDENTITY_WEIGHTING,
        judgeReliability: new Map([["a", 0.5]]),
      }),
    ).toThrow(/not both/);
    expect(() =>
      computeReferralSignal("v", rs, {
        weighting: IDENTITY_WEIGHTING,
        judgeBias: new Map([["a", 0.5]]),
      }),
    ).toThrow(/not both/);
  });

  test("an ineligible edge takes no Top-K slot, whatever the weighting reports", () => {
    const rs = [referral({ referrerId: "good" }), referral({ referrerId: "bad" })];
    const res = computeReferralSignal("v", rs, {
      topK: 2,
      weighting: judgeWeighting({ reliability: new Map([["bad", 0]]) }),
    });
    expect(res.incomingCount).toBe(2);
    expect(res.usedCount).toBe(1);
    expect(res.contributing.map((c) => c.referral.referrerId)).toEqual(["good"]);
    // `strongest` stays the raw max R_uv over all incoming, weights or not.
    expect(res.strongest).toBe(res.contributing[0]?.breakdown.strength as number);
  });

  test("a weighting reporting no judge factors leaves `judge` neutral, never 0", () => {
    const passthrough: EdgeWeighting = {
      kind: "passthrough",
      weighted: true,
      weigh: (e) => ({ contribution: e.strength, eligible: true, factors: {} }),
    };
    const res = computeReferralSignal("v", [referral()], { weighting: passthrough });
    const c = res.contributing[0];
    expect(res.judgeWeighted).toBe(true);
    expect(c?.judge).toEqual({
      reliability: 1,
      bias: 0,
      adjusted: c?.breakdown.strength as number,
    });
  });
});
