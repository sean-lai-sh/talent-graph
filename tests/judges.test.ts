import { describe, expect, test } from "bun:test";
import type { Opportunity, Outcome, Person, Referral } from "../src/domain/types.ts";
import { opportunityBucket, residualOutcomes } from "../src/judges/outcomes.ts";
import {
  biasCorrections,
  computeJudgeCalibration,
  estimateJudgeReliability,
  judgeWeightOptions,
  reliabilityWeights,
  scoreReferralPredictions,
  toJudgeBias,
  toJudgeCalibration,
} from "../src/judges/reliability.ts";
import { JUDGE_RELIABILITY_V2_0_0 } from "../src/models/registry.ts";
import type { JudgeReliabilitySpec } from "../src/models/spec.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";
import { referralStrength } from "../src/scoring/referralStrength.ts";
import { generateSeed } from "../src/seed/generate.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(T0.getTime() + n * DAY);
/** Well past the 180-day window for anything referred in the first month. */
const NOW = day(400);
const SPEC = JUDGE_RELIABILITY_V2_0_0;

let seq = 0;

function person(id: string): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0 };
}

function referral(
  from: string,
  to: string,
  conviction: 1 | 2 | 3 | 4 | 5,
  createdDay = 5,
  overrides: Partial<Referral> = {},
): Referral {
  seq++;
  return {
    id: `r-${seq}`,
    referrerId: from,
    candidateId: to,
    conviction,
    confidence: conviction,
    relationshipDepth: conviction,
    evidenceType: "firsthand_work",
    evidenceText: "Seen it.",
    createdAt: day(createdDay),
    updatedAt: day(createdDay),
    ...overrides,
  };
}

function outcome(
  personId: string,
  value: number | null,
  observedDay = 250,
  kind = "shipped_project",
): Outcome {
  seq++;
  return {
    id: `o-${seq}`,
    personId,
    opportunityId: null,
    kind,
    value,
    observedAt: day(observedDay),
    createdAt: day(observedDay),
  };
}

function opportunity(personId: string, startedDay = 60): Opportunity {
  seq++;
  return {
    id: `op-${seq}`,
    personId,
    kind: "grant",
    description: "seeded",
    startedAt: day(startedDay),
    endedAt: null,
    createdAt: day(startedDay),
  };
}

/* ------------------------------------------------------------------ *
 * Residual outcomes
 * ------------------------------------------------------------------ */

describe("residualOutcomes", () => {
  test("no outcomes ⇒ empty; null values and future observations are ignored", () => {
    expect(residualOutcomes([], [], SPEC, NOW).size).toBe(0);
    const m = residualOutcomes(
      [outcome("a", null), outcome("b", 5, 500)], // b observed after NOW
      [],
      SPEC,
      NOW,
    );
    expect(m.size).toBe(0);
  });

  test("with no opportunity data the residual ranking equals the raw ranking", () => {
    const m = residualOutcomes(
      [outcome("lo", 1), outcome("mid", 5), outcome("hi", 9)],
      [],
      SPEC,
      NOW,
    );
    expect(m.get("lo")?.truth).toBe(0);
    expect(m.get("mid")?.truth).toBe(0.5);
    expect(m.get("hi")?.truth).toBe(1);
    // Everyone is in one bucket: expectation is the global mean.
    const expected = m.get("lo")?.expected;
    expect(m.get("hi")?.expected).toBe(expected);
    expect(m.get("hi")?.residual).toBeCloseTo(1 - (expected as number), 12);
  });

  test("units differ across kinds but rank-normalisation makes them comparable", () => {
    const m = residualOutcomes(
      [
        outcome("a", 1_000_000, 250, "revenue"),
        outcome("b", 2_000_000, 250, "revenue"),
        outcome("c", 2, 250, "grade"),
        outcome("d", 4, 250, "grade"),
      ],
      [],
      SPEC,
      NOW,
    );
    expect(m.get("a")?.normalized).toBe(0);
    expect(m.get("b")?.normalized).toBe(1);
    expect(m.get("c")?.normalized).toBe(0);
    expect(m.get("d")?.normalized).toBe(1);
  });

  test("a person with several outcomes gets the mean of their normalised values", () => {
    const m = residualOutcomes([outcome("a", 1), outcome("a", 9), outcome("b", 5)], [], SPEC, NOW);
    expect(m.get("a")?.normalized).toBe(0.5);
    expect(m.get("a")?.outcomeIds).toHaveLength(2);
  });

  test("opportunity correction: same raw outcome, more opportunity ⇒ lower residual and truth", () => {
    // Two buckets of two: bucket 0 (no opportunity) and bucket 1 (one opportunity).
    const outcomes = [
      outcome("free1", 4),
      outcome("free2", 2),
      outcome("boosted1", 4),
      outcome("boosted2", 6),
    ];
    const opps = [opportunity("boosted1"), opportunity("boosted2")];
    const m = residualOutcomes(outcomes, opps, SPEC, NOW);
    expect(m.get("boosted1")?.opportunityCount).toBe(1);
    expect(m.get("free1")?.opportunityCount).toBe(0);
    // free1 and boosted1 share the raw value 4 …
    expect(m.get("free1")?.normalized).toBe(m.get("boosted1")?.normalized as number);
    // … but boosted1's peers did better, so its residual is lower.
    expect(m.get("boosted1")?.residual).toBeLessThan(m.get("free1")?.residual as number);
    expect(m.get("boosted1")?.truth).toBeLessThan(m.get("free1")?.truth as number);
  });

  test("a bucket below minBucketSize falls back to the global mean", () => {
    const outcomes = [outcome("a", 1), outcome("b", 5), outcome("c", 9)];
    const m = residualOutcomes(outcomes, [opportunity("c")], SPEC, NOW);
    const globalMean = (0 + 0.5 + 1) / 3;
    expect(m.get("c")?.expected).toBeCloseTo(globalMean, 12);
  });

  test("opportunities that start after the outcome do not count", () => {
    const m = residualOutcomes([outcome("a", 1, 100)], [opportunity("a", 200)], SPEC, NOW);
    expect(m.get("a")?.opportunityCount).toBe(0);
  });

  test("opportunityBucket thresholds", () => {
    expect(opportunityBucket(0, [1, 2, 3])).toBe(0);
    expect(opportunityBucket(1, [1, 2, 3])).toBe(1);
    expect(opportunityBucket(2, [1, 2, 3])).toBe(2);
    expect(opportunityBucket(7, [1, 2, 3])).toBe(3);
    expect(opportunityBucket(7, [])).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Scoring predictions at time step T
 * ------------------------------------------------------------------ */

describe("scoreReferralPredictions (time step T)", () => {
  const truths = residualOutcomes([outcome("v", 9, 250), outcome("w", 1, 250)], [], SPEC, NOW);

  test("a referral inside the observation window is not evaluated yet", () => {
    const recent = referral("u", "v", 5, 300); // 100 days before NOW < 180
    const old = referral("u", "v", 5, 5);
    const scored = scoreReferralPredictions([recent, old], truths, SPEC, NOW);
    expect(scored.map((p) => p.referralId)).toEqual([old.id]);
  });

  test("an outcome observed before the referral cannot score it", () => {
    const late = referral("u", "v", 5, 260); // after v's outcome at day 250
    const scored = scoreReferralPredictions([late], truths, SPEC, day(1000));
    expect(scored).toHaveLength(0);
  });

  test("a candidate without any outcome is not scored", () => {
    const scored = scoreReferralPredictions([referral("u", "nobody", 5)], truths, SPEC, NOW);
    expect(scored).toHaveLength(0);
  });

  test("prediction is the unweighted R_uv; error is the squared gap to truth", () => {
    const r = referral("u", "v", 5); // R = 1, truth(v) = 1
    const bad = referral("u", "w", 5); // R = 1, truth(w) = 0
    const [pv, pw] = scoreReferralPredictions([r, bad], truths, SPEC, NOW);
    expect(pv?.prediction).toBe(referralStrength(r));
    expect(pv?.error).toBe(0);
    expect(pw?.error).toBe(1);
    expect(pw?.signedError).toBe(1);
  });

  test("scored predictions are ordered chronologically by evaluation", () => {
    const t = residualOutcomes([outcome("v", 9, 220), outcome("w", 1, 210)], [], SPEC, NOW);
    const scored = scoreReferralPredictions(
      [referral("u", "v", 5), referral("u", "w", 5)],
      t,
      SPEC,
      NOW,
    );
    expect(scored.map((p) => p.candidateId)).toEqual(["w", "v"]);
  });
});

/* ------------------------------------------------------------------ *
 * Reliability, shrinkage, bias
 * ------------------------------------------------------------------ */

describe("estimateJudgeReliability", () => {
  const truths = residualOutcomes(
    [outcome("hi", 9), outcome("mid", 5), outcome("lo", 1)],
    [],
    SPEC,
    NOW,
  );

  test("an accurate judge beats an inaccurate one; an unevaluated judge sits at the prior", () => {
    const refs = [
      referral("good", "hi", 5), // predicts 1.0, truth 1.0
      referral("good", "lo", 1), // predicts 0.0, truth 0.0
      referral("bad", "lo", 5), // predicts 1.0, truth 0.0
      referral("bad", "hi", 1), // predicts 0.0, truth 1.0
    ];
    const est = estimateJudgeReliability(
      ["good", "bad", "silent"],
      scoreReferralPredictions(refs, truths, SPEC, NOW),
      SPEC,
    );
    const good = est.get("good");
    const bad = est.get("bad");
    const silent = est.get("silent");
    expect(good?.meanSquaredError).toBe(0);
    expect(good?.rawReliability).toBe(1);
    expect(good?.reliability).toBe(1);
    expect(bad?.meanSquaredError).toBe(1);
    expect(bad?.rawReliability).toBeCloseTo(Math.exp(-4), 12);
    expect(bad?.reliability).toBeLessThan(good?.reliability as number);
    expect(silent?.evaluatedCount).toBe(0);
    expect(silent?.reliability).toBe(SPEC.priorReliability);
    expect(silent?.rawReliability).toBeNull();
    expect(silent?.bias).toBe(0);
  });

  test("shrinkage: n wrong calls move p̂ further than one wrong call", () => {
    const once = estimateJudgeReliability(
      ["j"],
      scoreReferralPredictions([referral("j", "lo", 5)], truths, SPEC, NOW),
      SPEC,
    );
    const five = estimateJudgeReliability(
      ["j"],
      scoreReferralPredictions(
        [1, 2, 3, 4, 5].map((i) => referral("j", "lo", 5, i)),
        truths,
        SPEC,
        NOW,
      ),
      SPEC,
    );
    const p1 = once.get("j")?.reliability as number;
    const p5 = five.get("j")?.reliability as number;
    expect(p1).toBeLessThan(1);
    expect(p5).toBeLessThan(p1);
    // Closed form: n/(n+λ)·e^{−τ} + λ/(n+λ)·μ with λ = 3, μ = 1, Ē = 1.
    expect(p1).toBeCloseTo((1 / 4) * Math.exp(-4) + 3 / 4, 12);
    expect(p5).toBeCloseTo((5 / 8) * Math.exp(-4) + 3 / 8, 12);
  });

  test("the running error is an exponentially weighted average in evaluation order", () => {
    // Wrong first (error 1 at day 210), then right (error 0 at day 220).
    const t = residualOutcomes([outcome("lo", 1, 210), outcome("hi", 9, 220)], [], SPEC, NOW);
    const est = estimateJudgeReliability(
      ["j"],
      scoreReferralPredictions([referral("j", "lo", 5), referral("j", "hi", 5)], t, SPEC, NOW),
      SPEC,
    );
    // Ē = (1−η)·1 + η·0 = 0.7
    expect(est.get("j")?.meanSquaredError).toBeCloseTo(0.7, 12);

    // Reverse order (right first, then wrong): Ē = (1−η)·0 + η·1 = 0.3
    const t2 = residualOutcomes([outcome("lo", 1, 220), outcome("hi", 9, 210)], [], SPEC, NOW);
    const est2 = estimateJudgeReliability(
      ["j"],
      scoreReferralPredictions([referral("j", "lo", 5), referral("j", "hi", 5)], t2, SPEC, NOW),
      SPEC,
    );
    expect(est2.get("j")?.meanSquaredError).toBeCloseTo(0.3, 12);
  });

  test("a judge who systematically overrates has positive bias; underrating is negative", () => {
    const refs = [
      referral("over", "lo", 5),
      referral("over", "mid", 5),
      referral("under", "hi", 1),
    ];
    const est = estimateJudgeReliability(
      ["over", "under"],
      scoreReferralPredictions(refs, truths, SPEC, NOW),
      SPEC,
    );
    expect(est.get("over")?.rawBias).toBeGreaterThan(0);
    expect(est.get("over")?.bias).toBeGreaterThan(0);
    expect(est.get("under")?.bias).toBeLessThan(0);
    // Shrunk toward 0.
    expect(Math.abs(est.get("over")?.bias as number)).toBeLessThan(
      Math.abs(est.get("over")?.rawBias as number),
    );
  });
});

/* ------------------------------------------------------------------ *
 * End to end: calibration → weighted Referral Signal
 * ------------------------------------------------------------------ */

describe("computeJudgeCalibration and the Referral Signal hook", () => {
  const people = ["good", "bad", "v", "w", "x"].map(person);
  const referrals = [
    referral("good", "v", 4),
    referral("bad", "v", 4),
    referral("good", "w", 5), // w turns out great
    referral("bad", "x", 5), // x turns out poor
  ];
  const outcomes = [outcome("v", 5), outcome("w", 9), outcome("x", 1)];

  test("no outcomes ⇒ every judge at the prior and the weighted signal equals V0 exactly", () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes: [], now: NOW });
    expect(run.predictions).toHaveLength(0);
    expect(run.populationMeanReliability).toBeNull();
    for (const e of run.estimates.values()) expect(e.reliability).toBe(1);

    const v0 = computeAllReferralSignals(people, referrals);
    const v2 = computeAllReferralSignals(people, referrals, judgeWeightOptions(run));
    for (const id of v0.keys()) {
      expect(v2.get(id)?.signal).toBe(v0.get(id)?.signal as number);
      expect(v2.get(id)?.contributing.map((c) => c.referral.id)).toEqual(
        v0.get(id)?.contributing.map((c) => c.referral.id) as string[],
      );
    }
    expect(v2.get("v")?.judgeWeighted).toBe(true);
    expect(v0.get("v")?.judgeWeighted).toBe(false);
  });

  test("with outcomes the unreliable judge's referral contributes less", () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW });
    const weights = reliabilityWeights(run);
    expect(weights.get("good")).toBeGreaterThan(weights.get("bad") as number);
    expect(run.options.evaluatedReferrals).toBe(4);
    expect(run.options.judgesWithEvidence).toBe(2);
    expect(run.populationMeanReliability).not.toBeNull();

    const v0 = computeAllReferralSignals(people, referrals);
    const v2 = computeAllReferralSignals(people, referrals, judgeWeightOptions(run));
    // v has identical referrals from both judges; only the weighting differs.
    const contributions = v2.get("v")?.contributing ?? [];
    const fromGood = contributions.find((c) => c.referral.referrerId === "good");
    const fromBad = contributions.find((c) => c.referral.referrerId === "bad");
    expect(fromGood?.breakdown.strength).toBe(fromBad?.breakdown.strength as number);
    expect(fromGood?.strength).toBeGreaterThan(fromBad?.strength as number);
    expect(fromBad?.judge.reliability).toBe(weights.get("bad") as number);
    expect(v2.get("v")?.signal).toBeLessThan(v0.get("v")?.signal as number);
    // Provenance of the weighting is on the result.
    expect(fromGood?.judge.adjusted).toBe(fromGood?.breakdown.strength as number);
    // `strongest` keeps its contract: the raw max R_uv, unaffected by weights.
    expect(v2.get("v")?.strongest).toBe(v0.get("v")?.strongest as number);
    expect(v2.get("x")?.strongest).toBe(1);
    expect(v2.get("x")?.contributing[0]?.strength).toBeLessThan(1);
  });

  test("bias correction is off by default and lowers an overrating judge when enabled", () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW });
    expect(judgeWeightOptions(run).judgeBias).toBeUndefined();

    const withBias = computeJudgeCalibration({
      people,
      referrals,
      outcomes,
      now: NOW,
      spec: { ...SPEC, applyBiasCorrection: true },
    });
    const opts = judgeWeightOptions(withBias);
    expect(opts.judgeBias).toBeDefined();
    expect(biasCorrections(withBias).get("bad")).toBeGreaterThan(0);
    const plain = computeAllReferralSignals(people, referrals, judgeWeightOptions(run));
    const corrected = computeAllReferralSignals(people, referrals, opts);
    const bad = corrected.get("x")?.contributing[0];
    expect(bad?.judge.bias).toBeGreaterThan(0);
    expect(bad?.judge.adjusted).toBeLessThan(bad?.breakdown.strength as number);
    expect(corrected.get("x")?.signal).toBeLessThan(plain.get("x")?.signal as number);
  });

  test("Top-K can reorder under judge weights", () => {
    // Two referrals into t: a strong one from the bad judge, a weaker one from the good judge.
    // Two wrong calls (x, y both turn out poor) take the bad judge to
    // p̂ = 2/5·e^{−4} + 3/5 ≈ 0.61, below the good judge's 0.75 referral.
    const ppl = ["good", "bad", "t", "w", "x", "y"].map(person);
    const refs = [
      referral("bad", "t", 5),
      referral("good", "t", 4),
      referral("good", "w", 5),
      referral("bad", "x", 5),
      referral("bad", "y", 5),
    ];
    const run = computeJudgeCalibration({
      people: ppl,
      referrals: refs,
      outcomes: [outcome("w", 9), outcome("x", 1), outcome("y", 2)],
      now: NOW,
    });
    const v0 = computeAllReferralSignals(ppl, refs, { topK: 1 });
    const v2 = computeAllReferralSignals(ppl, refs, { topK: 1, ...judgeWeightOptions(run) });
    expect(v0.get("t")?.contributing[0]?.referral.referrerId).toBe("bad");
    expect(v2.get("t")?.contributing[0]?.referral.referrerId).toBe("good");
  });

  test("rejects an invalid spec at the entry point and invalid weights in scoring", () => {
    expect(() =>
      computeJudgeCalibration({
        people,
        referrals,
        outcomes,
        now: NOW,
        spec: { ...SPEC, learningRate: 0 },
      }),
    ).toThrow(/learningRate/);
    expect(() =>
      computeAllReferralSignals(people, referrals, { judgeReliability: new Map([["good", 1.5]]) }),
    ).toThrow(/reliability/);
  });

  test("persistable records", () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW });
    const e = run.estimates.get("bad");
    if (!e) throw new Error("expected estimate");
    const jc = toJudgeCalibration(e, NOW);
    const jb = toJudgeBias(e, NOW);
    expect(jc).toMatchObject({ judgeId: "bad", observationCount: 2, dimension: null });
    expect(jc.reliability).toBe(e.reliability);
    expect(jb.bias).toBe(e.bias);
    expect(jc.updatedAt).not.toBe(NOW); // copied, not retained
    expect(jc.updatedAt).toEqual(NOW);
  });

  test("deterministic and `now` is copied into options", () => {
    const a = computeJudgeCalibration({ people, referrals, outcomes, now: NOW });
    const b = computeJudgeCalibration({ people, referrals, outcomes, now: NOW });
    expect(a).toEqual(b);
    expect(a.options.now).not.toBe(NOW);
    expect(a.options.now).toEqual(NOW);
  });
});

/* ------------------------------------------------------------------ *
 * Seed
 * ------------------------------------------------------------------ */

describe("seed longitudinal records", () => {
  const data = generateSeed();

  test("the seed carries opportunities and outcomes that calibrate some judges", () => {
    expect(data.outcomes.length).toBeGreaterThanOrEqual(15);
    expect(data.opportunities.length).toBeGreaterThanOrEqual(5);
    const run = computeJudgeCalibration({
      people: data.people,
      referrals: data.referrals,
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      now: new Date("2026-12-31T00:00:00.000Z"),
    });
    expect(run.options.evaluatedReferrals).toBeGreaterThan(10);
    expect(run.options.judgesWithEvidence).toBeGreaterThan(3);
    const values = [...run.estimates.values()].map((e) => e.reliability);
    expect(Math.min(...values)).toBeLessThan(1);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
  });

  test("before the window closes nothing is evaluated and the signal is untouched", () => {
    const early = computeJudgeCalibration({
      people: data.people,
      referrals: data.referrals,
      outcomes: data.outcomes,
      opportunities: data.opportunities,
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(early.options.evaluatedReferrals).toBe(0);
    const v0 = computeAllReferralSignals(data.people, data.referrals);
    const v2 = computeAllReferralSignals(data.people, data.referrals, judgeWeightOptions(early));
    for (const id of v0.keys()) expect(v2.get(id)?.signal).toBe(v0.get(id)?.signal as number);
  });

  test("spec with no opportunity buckets yields no opportunity correction", () => {
    const flat: JudgeReliabilitySpec = { ...SPEC, opportunityBuckets: [] };
    const now = new Date("2026-12-31T00:00:00.000Z");
    const t = residualOutcomes(data.outcomes, data.opportunities, flat, now);
    const expected = new Set([...t.values()].map((r) => r.expected.toFixed(12)));
    expect(expected.size).toBe(1);
  });
});
