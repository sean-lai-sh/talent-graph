/**
 * Judge calibration — learning who is good at identifying talent.
 *
 * A referral u → v made at time t is a prediction x_uv (its V0 strength R_uv,
 * unweighted). Once T − t has cleared the observation window it is scored
 * against a causal label built from v's outcomes observed after t (outcomes.ts):
 *
 *   truth_uv = percentile of R*_v among the cohort, R*_v from post-referral outcomes
 *   E_uv     = (x_uv − truth_uv)²
 *   Ē_u     ← (1 − η)·Ē_u + η·E_uv          in chronological order of evaluation
 *   p_u      = exp(−τ·Ē_u)
 *   p̂_u      = n/(n+λ)·p_u + λ/(n+λ)·μ_p     shrinkage against instant oracles
 *   b_u     ← (1 − η)·b_u + η·(x_uv − truth_uv)   signed bias, shrunk toward 0
 *
 * Observation model: one prediction per (judge, candidate) pair — the earliest
 * referral — matching the ingest invariant in validateReferral. A referral
 * edited after creation (`updatedAt > createdAt`) is not a frozen prediction
 * and is excluded unless the spec says otherwise.
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
import {
  buildOutcomeCohort,
  labelForPrediction,
  type OutcomeCohort,
  type PredictionLabel,
  type ResidualOutcome,
} from "./outcomes.ts";

const DAY = 86_400_000;

export interface ScoredPrediction {
  referralId: string;
  judgeId: string;
  candidateId: string;
  /** x_uv — the referral's unweighted V0 strength. */
  prediction: number;
  /** truth_uv from the post-referral residual label. */
  truth: number;
  /** (x − truth)² */
  error: number;
  /** x − truth */
  signedError: number;
  /**
   * First instant this prediction could be scored: max(createdAt + window,
   * label.firstEligibleAt). Kind size, not just the first later outcome.
   */
  evaluatedAt: Date;
  /** Everything the label was built from. */
  label: PredictionLabel;
}

export interface SkippedReferral {
  referralId: string;
  reason:
    | "self_referral"
    | "duplicate_pair"
    | "edited_after_creation"
    | "too_recent"
    | "no_later_outcome";
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
  /** Person-level snapshot at T (reporting view). */
  truths: Map<string, ResidualOutcome>;
  predictions: ScoredPrediction[];
  /** Referrals not scored, with the reason. */
  skipped: SkippedReferral[];
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
 * Score every referral that is evaluable at the cohort's `now`.
 *
 * One prediction per (judge, candidate): the earliest referral by createdAt
 * (then id). Self-referrals and, by default, referrals edited after creation
 * are skipped. A referral is scored only once `T − t_uv` has cleared the
 * observation window and the candidate has a later outcome in a kind that
 * has reached `minKindSize`. `evaluatedAt` is that first eligible instant
 * (window opening if the outcome arrived earlier).
 */
export function scoreReferralPredictions(
  referrals: readonly Referral[],
  cohort: OutcomeCohort,
  referralSpec: ReferralSignalSpec = CURRENT_SPECS.referral_signal,
): { predictions: ScoredPrediction[]; skipped: SkippedReferral[] } {
  const spec = cohort.spec;
  const skipped: SkippedReferral[] = [];
  const nowMs = cohort.now.getTime();
  const windowMs = spec.observationWindowDays * DAY;

  // Earliest referral per pair. Nested map so opaque ids cannot collide.
  const sorted = [...referrals].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const seenPair = new Map<string, Set<string>>();
  const out: ScoredPrediction[] = [];
  for (const r of sorted) {
    if (r.referrerId === r.candidateId) {
      skipped.push({ referralId: r.id, reason: "self_referral" });
      continue;
    }
    const seen = seenPair.get(r.referrerId) ?? new Set<string>();
    if (seen.has(r.candidateId)) {
      skipped.push({ referralId: r.id, reason: "duplicate_pair" });
      continue;
    }
    seen.add(r.candidateId);
    seenPair.set(r.referrerId, seen);
    if (spec.excludeEditedReferrals && r.updatedAt.getTime() > r.createdAt.getTime()) {
      skipped.push({ referralId: r.id, reason: "edited_after_creation" });
      continue;
    }
    if (nowMs - r.createdAt.getTime() < windowMs) {
      skipped.push({ referralId: r.id, reason: "too_recent" });
      continue;
    }
    const label = labelForPrediction(cohort, r.candidateId, r.createdAt);
    if (label === null) {
      skipped.push({ referralId: r.id, reason: "no_later_outcome" });
      continue;
    }
    const prediction = referralStrength(r, referralSpec);
    const signedError = prediction - label.truth;
    // First moment the prediction was allowed to be scored: max(kind
    // eligibility, createdAt + window). A day-20 outcome does not sort
    // before the window opens, and a rare kind does not stamp day-190
    // when the cohort only became rankable on day 310.
    const eligibleAt = r.createdAt.getTime() + windowMs;
    const evaluatedAt = new Date(Math.max(label.firstEligibleAt.getTime(), eligibleAt));
    out.push({
      referralId: r.id,
      judgeId: r.referrerId,
      candidateId: r.candidateId,
      prediction,
      truth: label.truth,
      error: signedError * signedError,
      signedError,
      evaluatedAt,
      label,
    });
  }
  out.sort(
    (a, b) =>
      a.evaluatedAt.getTime() - b.evaluatedAt.getTime() ||
      (a.referralId < b.referralId ? -1 : a.referralId > b.referralId ? 1 : 0),
  );
  return { predictions: out, skipped };
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
  const cohort = buildOutcomeCohort(input.outcomes, input.opportunities ?? [], spec, input.now);
  const { predictions, skipped } = scoreReferralPredictions(input.referrals, cohort, referralSpec);
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
    truths: cohort.snapshot,
    predictions,
    skipped,
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
