/**
 * Scout information gain Ĝ_u — a second judge number, next to p̂_u.
 *
 * This is a V3 *reading* of the white paper's "Reward Information Gain, Not
 * Obvious Predictions" section, not a transcription of
 *
 *   |R*_v − R̂_v^{−u}| × Accuracy(u,v).
 *
 * The paper's quantity mixes a leave-one-out outcome forecast with a
 * reliability-style accuracy term. Here the surprise is the unweighted V0
 * Referral Signal of v just before the referral (how obvious v already was),
 * and the payoff is the causal residual slope ΔR*_v after the referral
 * (whether v actually compounded). Conviction / x_uv / R_uv never enter IG.
 * Ĝ_u is never added to p̂_u and never applied to Referral Signal.
 *
 *   π_v(t_uv) = unweighted V0 S_v of referrals with createdAt < t_uv,
 *               excluding judge u (missing / zero incoming ⇒ π = 0)
 *   IG_uv     = (1 − π_v(t_uv)) · max(ΔR*_v, 0)
 *               only if forecastKind === "will_compound" AND ΔR* is defined;
 *               otherwise the referral is skipped (not scored as a zero)
 *   Ĝ_u       = n/(n+λ) · mean(IG_uv) + λ/(n+λ) · 0
 *               λ = spec.scoutShrinkage ?? 3
 *
 * Slope window for a referral created at t_uv (picked and locked here):
 *   t0 = createdAt
 *   t1 = createdAt + max(observationWindowDays, slopeMinGapDays ?? 90) days
 *   residualSlope({ personId: candidateId, outcomes, opportunities, t0, t1, spec })
 *   skip when state !== "defined"
 *
 * Negative ΔR*: the row stays eligible (will_compound + defined slope).
 * IG = 0 via max(·, 0) and the row counts toward n — a failed compound
 * forecast is information, not an absence of a forecast. Undefined slope
 * or a non-scout forecastKind is a skip, not a zero.
 *
 * Pure: `now` is a parameter used only as `updatedAt`. This module never
 * imports `src/inference/`. π comes from `computeReferralSignal` (scoring).
 */

import type {
  Opportunity,
  Outcome,
  Person,
  Referral,
  ScoutInformationGain,
} from "../domain/types.ts";
import { CURRENT_SPECS } from "../models/registry.ts";
import { assertSpec, type JudgeReliabilitySpec, type ReferralSignalSpec } from "../models/spec.ts";
import { computeReferralSignal } from "../scoring/referralSignal.ts";
import { DEFAULT_SLOPE_MIN_GAP_DAYS, residualSlope } from "./slope.ts";

const DAY = 86_400_000;

/** Applied when the spec omits `scoutShrinkage` (judge_reliability@2.0.0). */
export const DEFAULT_SCOUT_SHRINKAGE = 3;

export interface ScoredScoutPrediction {
  referralId: string;
  judgeId: string;
  candidateId: string;
  /** π_v(t_uv) ∈ [0, 1] — unweighted V0 S_v, judge u excluded, createdAt < t_uv. */
  priorSignal: number;
  /** ΔR*_v. Defined by construction. */
  delta: number;
  /**
   * IG_uv = (1 − π_v) · max(ΔR*_v, 0).
   * Conviction / x_uv do not appear.
   */
  informationGain: number;
  t0: Date;
  t1: Date;
}

export type SkippedScoutReason =
  | "self_referral"
  | "edited_after_creation"
  | "not_will_compound"
  | "undefined_slope";

export interface SkippedScoutReferral {
  referralId: string;
  reason: SkippedScoutReason;
}

export interface ScoreScoutPredictionsInput {
  referrals: readonly Referral[];
  outcomes: readonly Outcome[];
  opportunities?: readonly Opportunity[];
  spec?: JudgeReliabilitySpec;
  /** Spec under which π_v is computed; defaults to CURRENT_SPECS.referral_signal. */
  referralSpec?: ReferralSignalSpec;
}

export interface ScoutInformationGainInput {
  people: readonly Person[];
  referrals: readonly Referral[];
  outcomes: readonly Outcome[];
  opportunities?: readonly Opportunity[];
  /** Copied onto each Ĝ_u as `updatedAt`. Never read as a clock. */
  now: Date;
  spec?: JudgeReliabilitySpec;
  referralSpec?: ReferralSignalSpec;
}

/**
 * Days from t0 to t1: max(observationWindowDays, slopeMinGapDays ?? 90).
 * Exported so tests can lock the window rule without re-deriving it.
 */
export function scoutSlopeGapDays(spec: JudgeReliabilitySpec): number {
  return Math.max(spec.observationWindowDays, spec.slopeMinGapDays ?? DEFAULT_SLOPE_MIN_GAP_DAYS);
}

function shrinkTowardZero(n: number, value: number, lambda: number): number {
  if (n === 0) return 0;
  return (n / (n + lambda)) * value + (lambda / (n + lambda)) * 0;
}

/**
 * Unweighted V0 S_v of referrals that landed strictly before `tUv`,
 * excluding judge `judgeId`. Missing or zero incoming ⇒ 0.
 */
function priorReferralSignal(
  candidateId: string,
  judgeId: string,
  tUv: Date,
  referrals: readonly Referral[],
  referralSpec: ReferralSignalSpec,
): number {
  const tUvMs = tUv.getTime();
  const prior = referrals.filter(
    (r) =>
      r.candidateId === candidateId && r.referrerId !== judgeId && r.createdAt.getTime() < tUvMs,
  );
  return computeReferralSignal(candidateId, prior, { spec: referralSpec }).s;
}

/**
 * Score every scout-eligible referral. A row is produced only when
 * `forecastKind === "will_compound"` and ΔR* is defined; everything else
 * is a skip, not a zero IG.
 */
export function scoreScoutPredictions(input: ScoreScoutPredictionsInput): {
  predictions: ScoredScoutPrediction[];
  skipped: SkippedScoutReferral[];
} {
  const spec = assertSpec(input.spec ?? CURRENT_SPECS.judge_reliability);
  const referralSpec = assertSpec(input.referralSpec ?? CURRENT_SPECS.referral_signal);
  const opportunities = input.opportunities ?? [];
  const gapDays = scoutSlopeGapDays(spec);
  const skipped: SkippedScoutReferral[] = [];
  const predictions: ScoredScoutPrediction[] = [];

  const sorted = [...input.referrals].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  for (const r of sorted) {
    if (r.referrerId === r.candidateId) {
      skipped.push({ referralId: r.id, reason: "self_referral" });
      continue;
    }
    if (spec.excludeEditedReferrals && r.updatedAt.getTime() > r.createdAt.getTime()) {
      skipped.push({ referralId: r.id, reason: "edited_after_creation" });
      continue;
    }
    if (r.forecastKind !== "will_compound") {
      skipped.push({ referralId: r.id, reason: "not_will_compound" });
      continue;
    }

    const t0 = new Date(r.createdAt.getTime());
    const t1 = new Date(r.createdAt.getTime() + gapDays * DAY);
    const slope = residualSlope({
      personId: r.candidateId,
      outcomes: input.outcomes,
      opportunities,
      t0,
      t1,
      spec,
    });
    if (slope.state !== "defined" || slope.delta === null) {
      skipped.push({ referralId: r.id, reason: "undefined_slope" });
      continue;
    }

    const priorSignal = priorReferralSignal(
      r.candidateId,
      r.referrerId,
      r.createdAt,
      input.referrals,
      referralSpec,
    );
    const informationGain = (1 - priorSignal) * Math.max(slope.delta, 0);
    predictions.push({
      referralId: r.id,
      judgeId: r.referrerId,
      candidateId: r.candidateId,
      priorSignal,
      delta: slope.delta,
      informationGain,
      t0,
      t1,
    });
  }

  return { predictions, skipped };
}

/**
 * Per-judge Ĝ_u. Judges with no evaluated scout rows sit at the prior (0).
 * `now` is copied onto each record as `updatedAt`.
 */
export function computeScoutInformationGain(
  input: ScoutInformationGainInput,
): Map<string, ScoutInformationGain> {
  const spec = assertSpec(input.spec ?? CURRENT_SPECS.judge_reliability);
  const lambda = spec.scoutShrinkage ?? DEFAULT_SCOUT_SHRINKAGE;
  const { predictions } = scoreScoutPredictions(input);

  const acc = new Map<string, { n: number; sum: number }>();
  for (const p of predictions) {
    const cur = acc.get(p.judgeId);
    if (!cur) acc.set(p.judgeId, { n: 1, sum: p.informationGain });
    else {
      cur.n++;
      cur.sum += p.informationGain;
    }
  }

  const ids = new Set<string>([...input.people.map((p) => p.id), ...acc.keys()]);
  const updatedAt = new Date(input.now.getTime());
  const out = new Map<string, ScoutInformationGain>();
  for (const judgeId of [...ids].sort()) {
    const a = acc.get(judgeId);
    if (!a) {
      out.set(judgeId, {
        judgeId,
        gain: 0,
        evaluatedCount: 0,
        rawGain: null,
        updatedAt: new Date(updatedAt.getTime()),
      });
      continue;
    }
    const rawGain = a.sum / a.n;
    out.set(judgeId, {
      judgeId,
      gain: shrinkTowardZero(a.n, rawGain, lambda),
      evaluatedCount: a.n,
      rawGain,
      updatedAt: new Date(updatedAt.getTime()),
    });
  }
  return out;
}
