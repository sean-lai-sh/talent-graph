/**
 * Versioned model specifications.
 *
 * Weights, multipliers, λ and thresholds are **data**, not constants scattered
 * through math functions. Every scoring/inference function takes a spec; a
 * change in any number ships as a new semver-tagged spec object plus an entry
 * in `docs/models/CHANGELOG.md`. Existing spec versions are never edited, so
 * any historical number stays reproducible from raw observations + spec version.
 *
 * See PLAN.md §11a and docs/issues/15-durable-updates.md.
 */

import { EVIDENCE_TYPES } from "../domain/constants.ts";
import type { EvidenceType } from "../domain/types.ts";

/** Parameters of the V0 Referral Signal. */
export interface ReferralSignalSpec {
  kind: "referral_signal";
  /** Semver, e.g. "0.1.0". */
  version: string;
  /** Must sum to 1. */
  weights: { conviction: number; confidence: number; relationshipDepth: number };
  evidenceMultiplier: Record<EvidenceType, number>;
  /** Number of strongest incoming referrals averaged into S_v. */
  topK: number;
}

/** Parameters of the V1 Bradley–Terry fit. */
export interface BradleyTerrySpec {
  kind: "bradley_terry";
  /** Semver, e.g. "1.0.0". */
  version: string;
  /** λ in L(θ) = −Σ logσ(θ_w − θ_l) + λ Σ θ_i². */
  regularization: number;
  maxIterations: number;
  /** Convergence tolerance on ‖∇L‖∞. */
  tolerance: number;
  minComparisons: number;
  minOpponents: number;
  tieHandling: "ignore" | "half";
  /**
   * κ ≥ 0 for the optional anchor prior κ·Σ(θ_i − θ_i^prev)². κ = 0 reproduces
   * the plain fit exactly. An engineering continuity device, not theory.
   */
  anchorStrength: number;
}

/**
 * Parameters of the V2 judge calibration (docs/theory/main.tex, sections
 * "Longitudinal Observation", "Learning Who Is Good at Identifying Talent",
 * "Shrinkage" and "Learning Judge Bias").
 *
 *   truth_uv = cohort percentile of R*_v built from v's post-window outcomes
 *   E_uv   = (x_uv − truth_uv)²                    prediction error of one referral
 *   Ē_u    ← (1 − η)·Ē_u + η·E_uv                 exponentially weighted, chronological
 *   p_u    = exp(−τ·Ē_u)                          raw reliability
 *   p̂_u    = n/(n+λ)·p_u + λ/(n+λ)·μ_p            shrunk toward the prior
 *   b_u    ← (1 − η)·b_u + η·(x_uv − truth_uv)    signed bias, shrunk the same way
 */
export interface JudgeReliabilitySpec {
  kind: "judge_reliability";
  /** Semver, e.g. "2.0.0". */
  version: string;
  /**
   * A referral becomes evaluable once this many days have passed from
   * `createdAt` to T (the paper's "fixed observation period"). The label
   * then uses every outcome observed after the referral and at or before T.
   */
  observationWindowDays: number;
  /** η ∈ (0, 1]: weight of the newest error in the running average. */
  learningRate: number;
  /** τ > 0 in p_u = exp(−τ·Ē_u). */
  errorScale: number;
  /** λ ≥ 0: evaluated predictions needed before an estimate outweighs the prior. */
  shrinkage: number;
  /** μ_p ∈ [0, 1]: reliability of a judge with no evaluated predictions. */
  priorReliability: number;
  /**
   * Opportunity-count thresholds that bucket people for the expectation
   * E[R_v | O_v]. `[1, 2, 3]` ⇒ buckets {0}, {1}, {2}, {3+}. Empty ⇒ one
   * bucket, i.e. no opportunity correction.
   */
  opportunityBuckets: number[];
  /** Minimum people in a bucket before its mean is trusted over the global mean. */
  minBucketSize: number;
  /** Outcome kinds with fewer measurable outcomes than this are ignored (a rank in a tiny kind is noise). */
  minKindSize: number;
  /**
   * Which opportunities are subtracted from a judge's label: those the
   * candidate already had at the referral ("referral"), or all up to the
   * latest contributing outcome ("outcome", the person-level snapshot rule).
   */
  opportunityClock: "referral" | "outcome";
  /** Skip referrals whose updatedAt is later than createdAt: an edited row is not a frozen prediction. */
  excludeEditedReferrals: boolean;
  /** Subtract the shrunk bias from a judge's prediction before weighting. */
  applyBiasCorrection: boolean;
  /**
   * Optional V3 fields. Absent on 2.0.0. When any is present, all three
   * must be valid. `scoutHook` gates whether `judgeWeightOptions` passes
   * scoutWeights; `scoutShrinkage` is used by scout gain; `slopeMinGapDays`
   * is used by residualSlope.
   */
  scoutHook?: boolean;
  /** λ_g ≥ 0. */
  scoutShrinkage?: number;
  /** Minimum t1 − t0 in days; ≥ 0. */
  slopeMinGapDays?: number;
}

export type ModelSpec = ReferralSignalSpec | BradleyTerrySpec | JudgeReliabilitySpec;

export type ModelSpecKind = ModelSpec["kind"];

/** Narrow a spec union by kind. */
export type SpecOfKind<K extends ModelSpecKind> = Extract<ModelSpec, { kind: K }>;

export type SpecValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * `MAJOR.MINOR.PATCH` with an optional build tag (`1.0.0+env`). The build tag
 * marks a spec derived from a registered version with env overrides applied;
 * registered versions themselves never carry one.
 */
const SEMVER = /^\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validateReferralSignalSpec(spec: ReferralSignalSpec, errors: string[]): void {
  const { conviction, confidence, relationshipDepth } = spec.weights ?? {};
  const weights = [conviction, confidence, relationshipDepth];

  if (!weights.every(isFiniteNumber)) {
    errors.push("weights.conviction / .confidence / .relationshipDepth must all be finite numbers");
  } else {
    if (weights.some((w) => w < 0)) errors.push("weights must be non-negative");
    const sum = (conviction as number) + (confidence as number) + (relationshipDepth as number);
    if (Math.abs(sum - 1) > 1e-9) errors.push(`weights must sum to 1 (got ${sum})`);
  }

  const multipliers = spec.evidenceMultiplier;
  if (multipliers === null || typeof multipliers !== "object") {
    errors.push("evidenceMultiplier must be an object keyed by evidence type");
  } else {
    for (const type of EVIDENCE_TYPES) {
      const m = multipliers[type];
      if (!isFiniteNumber(m)) errors.push(`evidenceMultiplier.${type} must be a finite number`);
      else if (m < 0 || m > 1)
        errors.push(`evidenceMultiplier.${type} must be in [0, 1] (got ${m})`);
    }
    for (const key of Object.keys(multipliers)) {
      if (!(EVIDENCE_TYPES as readonly string[]).includes(key)) {
        errors.push(`unknown evidence type in evidenceMultiplier: ${key}`);
      }
    }
  }

  if (!isPositiveInteger(spec.topK)) errors.push("topK must be a positive integer");
}

function validateBradleyTerrySpec(spec: BradleyTerrySpec, errors: string[]): void {
  if (!isFiniteNumber(spec.regularization) || spec.regularization < 0) {
    errors.push("regularization (λ) must be a finite number ≥ 0");
  }
  if (!isPositiveInteger(spec.maxIterations))
    errors.push("maxIterations must be a positive integer");
  if (!isFiniteNumber(spec.tolerance) || spec.tolerance <= 0) {
    errors.push("tolerance must be a finite number > 0");
  }
  if (!isPositiveInteger(spec.minComparisons)) {
    errors.push("minComparisons must be a positive integer");
  }
  if (!isPositiveInteger(spec.minOpponents)) errors.push("minOpponents must be a positive integer");
  if (spec.tieHandling !== "ignore" && spec.tieHandling !== "half") {
    errors.push('tieHandling must be "ignore" or "half"');
  }
  if (!isFiniteNumber(spec.anchorStrength) || spec.anchorStrength < 0) {
    errors.push("anchorStrength (κ) must be a finite number ≥ 0");
  }
}

function validateJudgeReliabilitySpec(spec: JudgeReliabilitySpec, errors: string[]): void {
  if (!isFiniteNumber(spec.observationWindowDays) || spec.observationWindowDays < 0) {
    errors.push("observationWindowDays must be a finite number ≥ 0");
  }
  if (!isFiniteNumber(spec.learningRate) || spec.learningRate <= 0 || spec.learningRate > 1) {
    errors.push("learningRate (η) must be in (0, 1]");
  }
  if (!isFiniteNumber(spec.errorScale) || spec.errorScale <= 0) {
    errors.push("errorScale (τ) must be a finite number > 0");
  }
  if (!isFiniteNumber(spec.shrinkage) || spec.shrinkage < 0) {
    errors.push("shrinkage (λ) must be a finite number ≥ 0");
  }
  if (
    !isFiniteNumber(spec.priorReliability) ||
    spec.priorReliability < 0 ||
    spec.priorReliability > 1
  ) {
    errors.push("priorReliability (μ_p) must be in [0, 1]");
  }
  if (!Array.isArray(spec.opportunityBuckets)) {
    errors.push("opportunityBuckets must be an array of thresholds");
  } else {
    let prev = 0;
    for (const t of spec.opportunityBuckets) {
      if (!Number.isInteger(t) || t <= prev) {
        errors.push("opportunityBuckets must be strictly increasing positive integers");
        break;
      }
      prev = t;
    }
  }
  if (!isPositiveInteger(spec.minBucketSize)) {
    errors.push("minBucketSize must be a positive integer");
  }
  if (!isPositiveInteger(spec.minKindSize)) {
    errors.push("minKindSize must be a positive integer");
  }
  if (spec.opportunityClock !== "referral" && spec.opportunityClock !== "outcome") {
    errors.push('opportunityClock must be "referral" or "outcome"');
  }
  if (typeof spec.excludeEditedReferrals !== "boolean") {
    errors.push("excludeEditedReferrals must be a boolean");
  }
  if (typeof spec.applyBiasCorrection !== "boolean") {
    errors.push("applyBiasCorrection must be a boolean");
  }

  const hasV3 =
    spec.scoutHook !== undefined ||
    spec.scoutShrinkage !== undefined ||
    spec.slopeMinGapDays !== undefined;
  if (hasV3) {
    if (typeof spec.scoutHook !== "boolean") {
      errors.push("scoutHook must be a boolean");
    }
    if (!isFiniteNumber(spec.scoutShrinkage) || spec.scoutShrinkage < 0) {
      errors.push("scoutShrinkage (λ_g) must be a finite number ≥ 0");
    }
    if (!isFiniteNumber(spec.slopeMinGapDays) || spec.slopeMinGapDays < 0) {
      errors.push("slopeMinGapDays must be a finite number ≥ 0");
    }
  }
}

/** Structural + numeric validation of a spec. Pure; never throws. */
export function validateSpec(spec: ModelSpec): SpecValidationResult {
  const errors: string[] = [];

  if (typeof spec.version !== "string" || !SEMVER.test(spec.version)) {
    errors.push(`version must be a semver string like "0.1.0" (got ${String(spec.version)})`);
  }

  switch (spec.kind) {
    case "referral_signal":
      validateReferralSignalSpec(spec, errors);
      break;
    case "bradley_terry":
      validateBradleyTerrySpec(spec, errors);
      break;
    case "judge_reliability":
      validateJudgeReliabilitySpec(spec, errors);
      break;
    default:
      errors.push(`unknown spec kind: ${String((spec as ModelSpec).kind)}`);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Throw on an invalid spec. Called once at each public scoring/inference
 * entry point so a corrupt spec (weights not summing to 1, λ = NaN, …) can
 * never stamp a version onto a result.
 */
export function assertSpec<S extends ModelSpec>(spec: S): S {
  const result = validateSpec(spec);
  if (!result.ok) {
    throw new Error(
      `invalid ${spec.kind} spec ${String(spec.version)}: ${result.errors.join("; ")}`,
    );
  }
  return spec;
}

/** Stable identifier for a spec, used in ModelRun records and drift reports. */
export function specId(spec: ModelSpec): string {
  return `${spec.kind}@${spec.version}`;
}
