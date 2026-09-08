/**
 * Judge calibration — learning who is good at identifying talent.
 *
 * A referral u → v made at time t is a prediction x_uv (its V0 strength R_uv,
 * unweighted). Once the observation window has passed and v has an outcome
 * observed after t, the prediction is scored against the opportunity-corrected
 * residual truth (outcomes.ts):
 *
 *   E_uv  = (x_uv − truth_v)²
 *   Ē_u   ← (1 − η)·Ē_u + η·E_uv          in chronological order of evaluation
 *   p_u   = exp(−τ·Ē_u)
 *   p̂_u   = n/(n+λ)·p_u + λ/(n+λ)·μ_p     shrinkage against instant oracles
 *   b_u   ← (1 − η)·b_u + η·(x_uv − truth_v)   signed bias, shrunk toward 0
 *
 * Circularity guard: truth comes only from outcomes, never from V1 capability
 * estimates, which are themselves built from judges' comparisons. This module
 * therefore never imports from `src/inference/` (asserted by the invariants
 * test). Pure: `now` is a parameter.
 */

import type {
  JudgeBias,
  JudgeCalibration,
  Opportunity,
  Outcome,
  Person,
  Referral,
} from "../domain/types.ts";
import { CURRENT_SPECS } from "../models/registry.ts";
import { assertSpec, type JudgeReliabilitySpec, type ReferralSignalSpec } from "../models/spec.ts";
import { referralStrength } from "../scoring/referralStrength.ts";
import { type ResidualOutcome, residualOutcomes } from "./outcomes.ts";

const DAY = 86_400_000;

export interface ScoredPrediction {
  referralId: string;
  judgeId: string;
  candidateId: string;
  /** x_uv — the referral's unweighted V0 strength. */
  prediction: number;
  /** truth_v from residual outcomes. */
  truth: number;
  /** (x − truth)² */
  error: number;
  /** x − truth */
  signedError: number;
  /** When the prediction became scorable: the latest contributing outcome. */
  evaluatedAt: Date;
}

export interface JudgeReliabilityEstimate {
  judgeId: string;
  /** n_u — evaluated predictions. */
  evaluatedCount: number;
  /** Ē_u, or null when nothing has been evaluated. */
  meanSquaredError: number | null;
  /** p_u = exp(−τ·Ē_u), or null when nothing has been evaluated. */
  rawReliability: number | null;
  /** p̂_u after shrinkage; equals the prior when nothing has been evaluated. */
  reliability: number;
  /** Running signed error, or null when nothing has been evaluated. */
  rawBias: number | null;
  /** b̂_u after shrinkage toward 0. */
  bias: number;
  /** Referral ids that were scored, in evaluation order. */
  predictionIds: string[];
}

export interface JudgeCalibrationRun {
  estimates: Map<string, JudgeReliabilityEstimate>;
  truths: Map<string, ResidualOutcome>;
  predictions: ScoredPrediction[];
  /** Mean raw reliability across judges with ≥1 evaluation; null if none. */
  populationMeanReliability: number | null;
  options: {
    specVersion: string;
    referralSpecVersion: string;
    now: Date;
    evaluatedReferrals: number;
    judgesWithEvidence: number;
    applyBiasCorrection: boolean;
  };
}

export interface JudgeCalibrationInput {
  people: readonly Person[];
  referrals: readonly Referral[];
  outcomes: readonly Outcome[];
  opportunities?: readonly Opportunity[];
  now: Date;
  spec?: JudgeReliabilitySpec;
  /** Spec under which x_uv is computed; defaults to CURRENT_SPECS.referral_signal. */
  referralSpec?: ReferralSignalSpec;
}

/**
 * Score every referral that is evaluable at `now`: the observation window has
 * elapsed since it was made, and the candidate has residual truth built from
 * at least one outcome observed after the referral.
 */
export function scoreReferralPredictions(
  referrals: readonly Referral[],
  truths: ReadonlyMap<string, ResidualOutcome>,
  spec: JudgeReliabilitySpec,
  now: Date,
  referralSpec: ReferralSignalSpec = CURRENT_SPECS.referral_signal,
): ScoredPrediction[] {
  const nowMs = now.getTime();
  const windowMs = spec.observationWindowDays * DAY;
  const out: ScoredPrediction[] = [];
  for (const r of referrals) {
    if (r.referrerId === r.candidateId) continue;
    const made = r.createdAt.getTime();
    if (nowMs - made < windowMs) continue;
    const truth = truths.get(r.candidateId);
    if (!truth || truth.latestObservedAt.getTime() <= made) continue;
    const prediction = referralStrength(r, referralSpec);
    const signedError = prediction - truth.truth;
    out.push({
      referralId: r.id,
      judgeId: r.referrerId,
      candidateId: r.candidateId,
      prediction,
      truth: truth.truth,
      error: signedError * signedError,
      signedError,
      evaluatedAt: truth.latestObservedAt,
    });
  }
  return out.sort(
    (a, b) =>
      a.evaluatedAt.getTime() - b.evaluatedAt.getTime() ||
      (a.referralId < b.referralId ? -1 : a.referralId > b.referralId ? 1 : 0),
  );
}

function shrink(n: number, value: number, prior: number, lambda: number): number {
  if (n === 0) return prior;
  return (n / (n + lambda)) * value + (lambda / (n + lambda)) * prior;
}

/** Fold scored predictions into per-judge reliability and bias estimates. */
export function estimateJudgeReliability(
  judgeIds: readonly string[],
  predictions: readonly ScoredPrediction[],
  spec: JudgeReliabilitySpec,
): Map<string, JudgeReliabilityEstimate> {
  const eta = spec.learningRate;
  const acc = new Map<string, { n: number; e: number; b: number; ids: string[] }>();
  for (const p of predictions) {
    const cur = acc.get(p.judgeId);
    if (!cur) {
      acc.set(p.judgeId, { n: 1, e: p.error, b: p.signedError, ids: [p.referralId] });
    } else {
      cur.n++;
      cur.e = (1 - eta) * cur.e + eta * p.error;
      cur.b = (1 - eta) * cur.b + eta * p.signedError;
      cur.ids.push(p.referralId);
    }
  }

  const ids = new Set<string>([...judgeIds, ...acc.keys()]);
  const out = new Map<string, JudgeReliabilityEstimate>();
  for (const judgeId of [...ids].sort()) {
    const a = acc.get(judgeId);
    if (!a) {
      out.set(judgeId, {
        judgeId,
        evaluatedCount: 0,
        meanSquaredError: null,
        rawReliability: null,
        reliability: spec.priorReliability,
        rawBias: null,
        bias: 0,
        predictionIds: [],
      });
      continue;
    }
    const raw = Math.exp(-spec.errorScale * a.e);
    out.set(judgeId, {
      judgeId,
      evaluatedCount: a.n,
      meanSquaredError: a.e,
      rawReliability: raw,
      reliability: shrink(a.n, raw, spec.priorReliability, spec.shrinkage),
      rawBias: a.b,
      bias: shrink(a.n, a.b, 0, spec.shrinkage),
      predictionIds: a.ids,
    });
  }
  return out;
}

/** Full V2 pass: residual truths → scored predictions → per-judge estimates. */
export function computeJudgeCalibration(input: JudgeCalibrationInput): JudgeCalibrationRun {
  const spec = assertSpec(input.spec ?? CURRENT_SPECS.judge_reliability);
  const referralSpec = assertSpec(input.referralSpec ?? CURRENT_SPECS.referral_signal);
  const truths = residualOutcomes(input.outcomes, input.opportunities ?? [], spec, input.now);
  const predictions = scoreReferralPredictions(
    input.referrals,
    truths,
    spec,
    input.now,
    referralSpec,
  );
  const estimates = estimateJudgeReliability(
    input.people.map((p) => p.id),
    predictions,
    spec,
  );
  const withEvidence = [...estimates.values()].filter((e) => e.rawReliability !== null);
  const populationMeanReliability =
    withEvidence.length === 0
      ? null
      : withEvidence.reduce((s, e) => s + (e.rawReliability as number), 0) / withEvidence.length;
  return {
    estimates,
    truths,
    predictions,
    populationMeanReliability,
    options: {
      specVersion: spec.version,
      referralSpecVersion: referralSpec.version,
      now: new Date(input.now.getTime()),
      evaluatedReferrals: predictions.length,
      judgesWithEvidence: withEvidence.length,
      applyBiasCorrection: spec.applyBiasCorrection,
    },
  };
}

/**
 * The V2 options to pass to `computeReferralSignal` / `computeAllReferralSignals`:
 * reliability always, bias only when the spec enables the correction.
 */
export function judgeWeightOptions(run: JudgeCalibrationRun): {
  judgeReliability: Map<string, number>;
  judgeBias?: Map<string, number>;
} {
  const judgeReliability = reliabilityWeights(run);
  return run.options.applyBiasCorrection
    ? { judgeReliability, judgeBias: biasCorrections(run) }
    : { judgeReliability };
}

/** p̂_u per judge, in the form `computeReferralSignal` accepts. */
export function reliabilityWeights(run: JudgeCalibrationRun): Map<string, number> {
  return new Map([...run.estimates.values()].map((e) => [e.judgeId, e.reliability]));
}

/** b̂_u per judge, in the form `computeReferralSignal` accepts. */
export function biasCorrections(run: JudgeCalibrationRun): Map<string, number> {
  return new Map([...run.estimates.values()].map((e) => [e.judgeId, e.bias]));
}

/** Persistable JudgeCalibration record for an application's store. */
export function toJudgeCalibration(e: JudgeReliabilityEstimate, updatedAt: Date): JudgeCalibration {
  return {
    id: `jc:${e.judgeId}`,
    judgeId: e.judgeId,
    dimension: null,
    reliability: e.reliability,
    observationCount: e.evaluatedCount,
    updatedAt: new Date(updatedAt.getTime()),
  };
}

/** Persistable JudgeBias record for an application's store. */
export function toJudgeBias(e: JudgeReliabilityEstimate, updatedAt: Date): JudgeBias {
  return {
    id: `jb:${e.judgeId}`,
    judgeId: e.judgeId,
    dimension: null,
    bias: e.bias,
    observationCount: e.evaluatedCount,
    updatedAt: new Date(updatedAt.getTime()),
  };
}
