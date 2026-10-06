/**
 * SEA-78 — judge_reliability@4.0.0: the r10 weight scale.
 *
 * `mode: "v2"` must be the old behaviour untouched; `mode: "v4"` maps p̂ through
 * a soft-capped logit to w and weights the signal by ω = w^γ.
 */
import { describe, expect, test } from "bun:test";
import type { Outcome, Person, Referral } from "../src/domain/types.ts";
import {
  computeJudgeCalibration,
  estimateJudgeReliability,
  judgeWeightOptions,
  reliabilityWeights,
  type ScoredPrediction,
} from "../src/judges/reliability.ts";
import { JUDGE_RELIABILITY_V2_0_0, JUDGE_RELIABILITY_V4_0_0 } from "../src/models/registry.ts";
import { assertSpec, type JudgeReliabilitySpec, validateSpec } from "../src/models/spec.ts";
import { computeAllReferralSignals } from "../src/scoring/referralSignal.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(T0.getTime() + n * DAY);
const NOW = day(400);
const V2 = JUDGE_RELIABILITY_V2_0_0;
const V4 = JUDGE_RELIABILITY_V4_0_0;

let seq = 0;

function person(id: string): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0 };
}

function referral(from: string, to: string, conviction: 1 | 2 | 3 | 4 | 5): Referral {
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
    createdAt: day(5),
    updatedAt: day(5),
  };
}

function outcome(personId: string, value: number): Outcome {
  seq++;
  return {
    id: `o-${seq}`,
    personId,
    opportunityId: null,
    kind: "shipped_project",
    value,
    observedAt: day(250),
    createdAt: day(250),
  };
}

/** A scored prediction with exactly the squared error the estimator folds in. */
function scored(judgeId: string, error: number, i = 0): ScoredPrediction {
  return {
    referralId: `sp-${judgeId}-${i}`,
    judgeId,
    candidateId: `c-${i}`,
    prediction: 0,
    truth: 0,
    error,
    signedError: Math.sqrt(error),
    evaluatedAt: day(200),
    label: undefined as never,
  };
}

const people = ["good", "bad", "silent", "hi", "mid", "lo"].map(person);
const outcomes = [outcome("hi", 9), outcome("mid", 5), outcome("lo", 1)];
const referrals = [
  referral("good", "hi", 5), // right on
  referral("good", "lo", 1),
  referral("bad", "lo", 5), // wrong both ways
  referral("bad", "hi", 1),
];

describe('judge_reliability mode "v2" is the compatibility branch', () => {
  test("2.0.0 is untouched: no v4 keys on the spec, mode absent reads as v2", () => {
    for (const k of ["mode", "softCap", "weightExponent"]) {
      expect(Object.hasOwn(V2, k)).toBe(false);
    }
    expect(V2.priorReliability).toBe(1);
    const explicit: JudgeReliabilitySpec = { ...V2, mode: "v2" };
    const a = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V2 });
    const b = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: explicit });
    expect(a.options.reliabilityMode).toBeUndefined();
    expect(b.options.reliabilityMode).toBeUndefined();
    expect([...b.estimates.values()]).toEqual([...a.estimates.values()]);
  });

  test("signal weights are p̂ exactly (no clamp), and w and ω are absent", () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V2 });
    const weights = reliabilityWeights(run);
    expect(weights.size).toBe(run.estimates.size);
    for (const e of run.estimates.values()) {
      expect(weights.get(e.judgeId)).toBe(e.reliability);
      expect(e.weight).toBeUndefined();
      expect(e.omega).toBeUndefined();
    }
    // A perfect judge reaches exactly 1 and the prior judge exactly 1: no clamp below 1.
    expect(weights.get("good")).toBe(1);
    expect(weights.get("silent")).toBe(1);
    expect(judgeWeightOptions(run).judgeReliability).toEqual(weights);
  });
});

describe('judge_reliability@4.0.0 (mode "v4")', () => {
  test("registered spec is valid and has the r10 values", () => {
    expect(assertSpec(V4)).toBe(V4);
    expect(V4.mode).toBe("v4");
    expect(V4.priorReliability).toBe(0.3);
    expect(V4.softCap).toBe(3);
    expect(V4.weightExponent).toBe(2);
  });

  test("validateSpec rejects a v4 spec whose w or ω can reach 0 or 1 in floating point", () => {
    for (const weightExponent of [Number.MIN_VALUE, 1e-20, 1e6, Number.MAX_VALUE]) {
      const res = validateSpec({ ...V4, weightExponent });
      expect(res.ok, `γ = ${weightExponent}`).toBe(false);
    }
    expect(validateSpec({ ...V4, softCap: 1e6 }).ok).toBe(true);
    expect(validateSpec({ ...V4, softCap: 1e6, weightExponent: 1 }).ok).toBe(true);
  });

  test("a judge with no scored referrals gets w = 0.3 and ω = 0.09", () => {
    const est = estimateJudgeReliability(["silent"], [], V4).get("silent");
    expect(est?.weight).toBe(0.3);
    expect(est?.omega).toBeCloseTo(0.09, 12);
    // Same through the full pass with no outcomes at all, and into the signal.
    const run = computeJudgeCalibration({ people, referrals, outcomes: [], now: NOW, spec: V4 });
    for (const e of run.estimates.values()) {
      expect(e.weight).toBe(0.3);
      expect(e.omega).toBeCloseTo(0.09, 12);
    }
    for (const w of reliabilityWeights(run).values()) expect(w).toBeCloseTo(0.09, 12);
  });

  test("the signal is fed ω, not w or p̂", () => {
    const run = computeJudgeCalibration({ people, referrals, outcomes, now: NOW, spec: V4 });
    const weights = judgeWeightOptions(run).judgeReliability;
    for (const e of run.estimates.values()) {
      expect(weights.get(e.judgeId)).toBe(e.omega as number);
      expect(e.omega).toBeCloseTo((e.weight as number) ** 2, 12);
    }
    const good = run.estimates.get("good");
    expect(good?.omega).not.toBe(good?.reliability);
  });

  test("w is monotone in p_u", () => {
    // Squared error sweeps from perfect to maximally wrong; p_u falls, so w must fall.
    const errors = [0, 0.01, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1];
    const ests = estimateJudgeReliability(
      errors.map((_, i) => `j${i}`),
      errors.map((e, i) => scored(`j${i}`, e)),
      V4,
    );
    const ws = errors.map((_, i) => ests.get(`j${i}`)?.weight as number);
    const ps = errors.map((_, i) => ests.get(`j${i}`)?.rawReliability as number);
    for (let i = 1; i < errors.length; i++) {
      expect(ps[i]).toBeLessThan(ps[i - 1] as number);
      expect(ws[i]).toBeLessThan(ws[i - 1] as number);
    }
    // It crosses μ0 in the right place: better than the prior is above 0.3, worse below.
    expect(ws[0]).toBeGreaterThan(0.3);
    expect(ws[ws.length - 1]).toBeLessThan(0.3);
  });

  describe("w and ω stay strictly inside (0, 1) for extreme accuracy", () => {
    // λ = 0 removes the shrink, so p̂ is exactly 1 or exactly 0.
    const extremes: [string, JudgeReliabilitySpec][] = [
      ["default cap", { ...V4, shrinkage: 0 }],
      // A huge cap makes tanh(Σ/T)·T ≈ Σ, so only the ε clamp keeps w off 0 and 1.
      ["huge cap", { ...V4, shrinkage: 0, softCap: 1e6 }],
      ["huge cap, γ = 1", { ...V4, shrinkage: 0, softCap: 1e6, weightExponent: 1 }],
    ];
    for (const [label, spec] of extremes) {
      test(label, () => {
        const ests = estimateJudgeReliability(
          ["perfect", "awful"],
          [scored("perfect", 0), scored("awful", 1e9)],
          spec,
        );
        expect(ests.get("perfect")?.reliability).toBe(1);
        expect(ests.get("awful")?.reliability).toBe(0);
        for (const e of ests.values()) {
          for (const v of [e.weight as number, e.omega as number]) {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThan(0);
            expect(v).toBeLessThan(1);
          }
        }
        expect(ests.get("perfect")?.weight as number).toBeGreaterThan(
          ests.get("awful")?.weight as number,
        );
      });

      test(`${label}: judgeWeighting never throws`, () => {
        // Perfect and maximally wrong judges end to end, through the signal.
        const extremeOutcomes = [outcome("hi", 1_000_000), outcome("lo", -1_000_000)];
        const run = computeJudgeCalibration({
          people,
          referrals,
          outcomes: extremeOutcomes,
          now: NOW,
          spec: { ...spec, errorScale: 1e9 },
        });
        expect(() => {
          const opts = judgeWeightOptions(run);
          const out = computeAllReferralSignals(people, referrals, opts);
          for (const s of out.values()) expect(Number.isFinite(s.signal)).toBe(true);
        }).not.toThrow();
      });
    }
  });
});
