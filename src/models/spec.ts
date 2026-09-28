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
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "../longitudinal/dimensions.ts";
import type { CareerEventKind, CareerEvidenceDimension } from "../longitudinal/types.ts";
import { CAREER_EVENT_KINDS } from "../longitudinal/types.ts";

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
}

/**
 * The career-evidence rubric: the rubric levels, question text, event
 * taxonomy and gate thresholds the longitudinal evidence pipeline judges
 * with. It produces no number of its own — it is the wording an answer is
 * given against, which is exactly why it is versioned: one edited level
 * description makes every judgment stamped with this version irreproducible.
 *
 * See `careerEvidenceRubricHash` for the fingerprint that catches such an edit.
 */
export interface CareerEvidenceSpec {
  kind: "career_evidence";
  /** Semver, e.g. "1.0.0". Never edited in place. */
  version: string;
  /** Model requested. The model that ANSWERED is recorded per judgment, not here. */
  model: string;
  /** Ordered rubric levels per dimension. Length defines the scale; index = level. */
  levels: Record<CareerEvidenceDimension, readonly [string, string, ...string[]]>;
  questions: {
    /** Instruction for the identity-linking decision the three criteria below answer. */
    identityDecision: string;
    /** Criteria for that decision, in order: different | review | same. */
    identity: readonly [string, string, string];
    identityFields: { name: string; affiliation: string; handle: string };
    eventKind: string;
    dimensions: Record<CareerEvidenceDimension, string>;
  };
  /** Event taxonomy, including the mandatory no-event escape hatch. */
  eventCriteria: Record<CareerEventKind | "no_supported_event", string>;
  thresholds: {
    identityConfidence: number;
    identityContradiction: number;
    eventConfidence: number;
    dimensionConfidence: number;
  };
}

/** Five anchored levels. Index is the level, from 0 through 4. */
export type CareerEvidenceLevelText = readonly [string, string, string, string, string];

export interface CareerEvidenceV11Spec {
  kind: "career_evidence";
  version: "1.1.0";
  model: string;
  claimClass: {
    question: string;
    selection: string;
    output: string;
    both: string;
  };
  selectivity: { question: string; levels: CareerEvidenceLevelText };
  difficulty: { question: string; levels: CareerEvidenceLevelText };
  generalized_impact: { question: string; levels: CareerEvidenceLevelText };
  ownership: {
    question: string;
    led: string;
    core_contributor: string;
    supporting: string;
  };
  selectivityCuts: readonly { maxRate: number; level: 1 | 2 | 3 | 4 }[];
  thresholds: {
    classConfidence: number;
    dimensionConfidence: number;
  };
}

export type CareerEvidenceRoleChoice =
  | "original_author"
  | "major_contributor"
  | "maintainer"
  | "minor_part";

export interface CareerEvidenceV12Spec {
  kind: "career_evidence";
  version: "1.2.0" | "1.2.1" | "1.2.2";
  model: string;
  claimClass: {
    question: string;
    selection: string;
    output: string;
    both: string;
  };
  selectivity: { question: string; levels: CareerEvidenceLevelText };
  pool_strength: { question: string; levels: CareerEvidenceLevelText };
  difficulty: { question: string; levels: CareerEvidenceLevelText };
  scale: { question: string; levels: CareerEvidenceLevelText };
  role: {
    question: string;
    original_author: string;
    major_contributor: string;
    maintainer: string;
    minor_part: string;
  };
  selectivityCuts: readonly { maxRate: number; level: 1 | 2 | 3 | 4 }[];
  thresholds: {
    classConfidence: number;
    dimensionConfidence: number;
  };
}

export type ModelSpec =
  | ReferralSignalSpec
  | BradleyTerrySpec
  | JudgeReliabilitySpec
  | CareerEvidenceSpec
  | CareerEvidenceV11Spec
  | CareerEvidenceV12Spec;

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
}

/** Every key `eventCriteria` must carry: the taxonomy plus the escape hatch. */
const EVENT_CRITERIA_KEYS: readonly string[] = [...CAREER_EVENT_KINDS, "no_supported_event"];

const EVIDENCE_THRESHOLD_KEYS = [
  "identityConfidence",
  "identityContradiction",
  "eventConfidence",
  "dimensionConfidence",
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateCareerEvidenceLevels(spec: CareerEvidenceSpec, errors: string[]): void {
  const levels = spec.levels as Record<string, unknown> | null | undefined;
  if (levels === null || typeof levels !== "object") {
    errors.push("levels must be an object keyed by dimension");
    return;
  }
  // The scale is shared: `MAX_LEVEL` and every divisor in the pipeline assume
  // one length across dimensions, so an unequal rubric is not a spec at all.
  let scale: number | null = null;
  for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
    const rubric = levels[dimension];
    if (!Array.isArray(rubric)) {
      errors.push(`levels.${dimension} is missing; every dimension needs a rubric`);
      continue;
    }
    if (rubric.length < 2) {
      errors.push(`levels.${dimension} must have at least 2 levels (got ${rubric.length})`);
    }
    // Temporary, until the vector normalises by `spec.levels[d].length - 1`
    // (a later `careerEvidenceVector(events, spec)`): `careerEvidenceVector`
    // and `outcomes.ts` still divide by the fixed `MAX_LEVEL`, so a 2- or
    // 6-level rubric would silently cap normalised values at 0.25 or push them
    // past 1.
    if (rubric.length !== MAX_LEVEL + 1) {
      errors.push(
        `levels.${dimension} has ${rubric.length} levels; the shared scale is 0..${MAX_LEVEL}, so it must have ${MAX_LEVEL + 1}`,
      );
    }
    if (!rubric.every(isNonEmptyString)) {
      errors.push(`levels.${dimension} descriptions must be non-empty strings`);
    }
    if (scale === null) scale = rubric.length;
    else if (rubric.length !== scale) {
      errors.push(
        `levels.${dimension} has ${rubric.length} levels; every dimension must share one scale (${scale})`,
      );
    }
  }
  for (const key of Object.keys(levels)) {
    if (!(CAREER_EVIDENCE_DIMENSIONS as readonly string[]).includes(key)) {
      errors.push(`unknown dimension in levels: ${key}`);
    }
  }
}

function validateCareerEvidenceQuestions(spec: CareerEvidenceSpec, errors: string[]): void {
  const questions = spec.questions;
  if (questions === null || typeof questions !== "object") {
    errors.push("questions must be an object");
    return;
  }
  if (!isNonEmptyString(questions.identityDecision)) {
    errors.push("questions.identityDecision must be a non-empty string");
  }
  if (!Array.isArray(questions.identity) || questions.identity.length !== 3) {
    errors.push("questions.identity must be three criteria: different, review, same");
  } else if (!questions.identity.every(isNonEmptyString)) {
    errors.push("questions.identity criteria must be non-empty strings");
  }
  const fields = questions.identityFields as Record<string, unknown> | null | undefined;
  if (fields === null || typeof fields !== "object") {
    errors.push("questions.identityFields must be an object");
  } else {
    for (const field of ["name", "affiliation", "handle"] as const) {
      if (!isNonEmptyString(fields[field])) {
        errors.push(`questions.identityFields.${field} must be a non-empty string`);
      }
    }
  }
  if (!isNonEmptyString(questions.eventKind)) {
    errors.push("questions.eventKind must be a non-empty string");
  }
  const dimensions = questions.dimensions as Record<string, unknown> | null | undefined;
  if (dimensions === null || typeof dimensions !== "object") {
    errors.push("questions.dimensions must be an object keyed by dimension");
  } else {
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      if (!isNonEmptyString(dimensions[dimension])) {
        errors.push(`questions.dimensions.${dimension} must be a non-empty string`);
      }
    }
    for (const key of Object.keys(dimensions)) {
      if (!(CAREER_EVIDENCE_DIMENSIONS as readonly string[]).includes(key)) {
        errors.push(`unknown dimension in questions.dimensions: ${key}`);
      }
    }
  }
}

const V11_LEVEL_KEYS = ["selectivity", "difficulty", "generalized_impact"] as const;
const V11_CUT_LEVELS = [4, 3, 2, 1] as const;
const V11_OWNERSHIP_KEYS = ["question", "led", "core_contributor", "supporting"] as const;
const V11_CLASS_KEYS = ["question", "selection", "output", "both"] as const;
const V11_BANNED_KEYS = [
  "levels",
  "questions",
  "eventCriteria",
  "peer_validation",
  "originality",
  "external_impact",
] as const;

function validateCareerEvidenceV11Spec(spec: CareerEvidenceV11Spec, errors: string[]): void {
  const raw = spec as unknown as Record<string, unknown>;
  if (spec.version !== "1.1.0") errors.push('version must be "1.1.0"');
  if (!isNonEmptyString(spec.model)) errors.push("model must be a non-empty string");
  for (const key of V11_BANNED_KEYS) {
    if (key in raw) errors.push(`${key} is not part of career_evidence@1.1.0`);
  }

  const claimClass = raw.claimClass as Record<string, unknown> | null | undefined;
  if (claimClass === null || typeof claimClass !== "object") {
    errors.push("claimClass must be an object");
  } else {
    for (const key of V11_CLASS_KEYS) {
      if (!isNonEmptyString(claimClass[key])) {
        errors.push(`claimClass.${key} must be a non-empty string`);
      }
    }
  }

  for (const key of V11_LEVEL_KEYS) {
    const dimension = raw[key] as Record<string, unknown> | null | undefined;
    if (dimension === null || typeof dimension !== "object") {
      errors.push(`${key} must be an object with a question and 5 levels`);
      continue;
    }
    if (!isNonEmptyString(dimension.question)) {
      errors.push(`${key}.question must be a non-empty string`);
    }
    const levels = dimension.levels;
    if (!Array.isArray(levels) || levels.length !== MAX_LEVEL + 1) {
      errors.push(`${key}.levels must have ${MAX_LEVEL + 1} entries (0..${MAX_LEVEL})`);
    } else if (!levels.every(isNonEmptyString)) {
      errors.push(`${key}.levels descriptions must be non-empty strings`);
    }
  }

  const ownership = raw.ownership as Record<string, unknown> | null | undefined;
  if (ownership === null || typeof ownership !== "object") {
    errors.push("ownership must be an object");
  } else {
    for (const key of V11_OWNERSHIP_KEYS) {
      if (!isNonEmptyString(ownership[key])) {
        errors.push(`ownership.${key} must be a non-empty string`);
      }
    }
    for (const key of Object.keys(ownership)) {
      if (!(V11_OWNERSHIP_KEYS as readonly string[]).includes(key)) {
        errors.push(`unknown ownership field: ${key}`);
      }
    }
  }

  validateSelectivityCuts(raw.selectivityCuts, errors);

  const thresholds = raw.thresholds as Record<string, unknown> | null | undefined;
  if (thresholds === null || typeof thresholds !== "object") {
    errors.push("thresholds must be an object");
  } else {
    for (const key of ["classConfidence", "dimensionConfidence"] as const) {
      const value = thresholds[key];
      if (!isFiniteNumber(value)) errors.push(`thresholds.${key} must be a finite number`);
      else if (value < 0 || value > 1) {
        errors.push(`thresholds.${key} must be in [0, 1] (got ${value})`);
      }
    }
  }
}

const V12_LEVEL_KEYS = ["selectivity", "pool_strength", "difficulty", "scale"] as const;
const V12_ROLE_KEYS = [
  "question",
  "original_author",
  "major_contributor",
  "maintainer",
  "minor_part",
] as const;
const V12_BANNED_KEYS = [
  "levels",
  "questions",
  "eventCriteria",
  "peer_validation",
  "originality",
  "external_impact",
  "generalized_impact",
  "ownership",
] as const;

function validateSelectivityCuts(cuts: unknown, errors: string[]): void {
  if (!Array.isArray(cuts) || cuts.length !== V11_CUT_LEVELS.length) {
    errors.push("selectivityCuts must be four inclusive upper bounds, for levels 4, 3, 2, 1");
    return;
  }
  let previousRate = 0;
  for (let index = 0; index < cuts.length; index++) {
    const cut = cuts[index] as { maxRate?: unknown; level?: unknown } | null;
    const level = V11_CUT_LEVELS[index];
    if (cut === null || typeof cut !== "object") {
      errors.push(`selectivityCuts[${index}] must be an object`);
      continue;
    }
    if (!isFiniteNumber(cut.maxRate) || cut.maxRate <= 0 || cut.maxRate > 1) {
      errors.push(`selectivityCuts[${index}].maxRate must be in (0, 1]`);
    } else if (cut.maxRate <= previousRate) {
      errors.push(
        "selectivityCuts maxRate values must be strictly increasing, strictest band first",
      );
    } else {
      previousRate = cut.maxRate;
    }
    if (cut.level !== level) {
      errors.push(`selectivityCuts[${index}].level must be ${level}`);
    }
  }
}

function validateCareerEvidenceV12Spec(spec: CareerEvidenceV12Spec, errors: string[]): void {
  const raw = spec as unknown as Record<string, unknown>;
  if (spec.version !== "1.2.0" && spec.version !== "1.2.1" && spec.version !== "1.2.2") {
    errors.push('version must be "1.2.0", "1.2.1", or "1.2.2"');
  }
  if (!isNonEmptyString(spec.model)) errors.push("model must be a non-empty string");
  for (const key of V12_BANNED_KEYS) {
    if (key in raw) errors.push(`${key} is not part of career_evidence@${spec.version}`);
  }

  const claimClass = raw.claimClass as Record<string, unknown> | null | undefined;
  if (claimClass === null || typeof claimClass !== "object") {
    errors.push("claimClass must be an object");
  } else {
    for (const key of V11_CLASS_KEYS) {
      if (!isNonEmptyString(claimClass[key])) {
        errors.push(`claimClass.${key} must be a non-empty string`);
      }
    }
  }

  for (const key of V12_LEVEL_KEYS) {
    const dimension = raw[key] as Record<string, unknown> | null | undefined;
    if (dimension === null || typeof dimension !== "object") {
      errors.push(`${key} must be an object with a question and 5 levels`);
      continue;
    }
    if (!isNonEmptyString(dimension.question)) {
      errors.push(`${key}.question must be a non-empty string`);
    }
    const levels = dimension.levels;
    if (!Array.isArray(levels) || levels.length !== MAX_LEVEL + 1) {
      errors.push(`${key}.levels must have ${MAX_LEVEL + 1} entries (0..${MAX_LEVEL})`);
    } else if (!levels.every(isNonEmptyString)) {
      errors.push(`${key}.levels descriptions must be non-empty strings`);
    }
  }

  const role = raw.role as Record<string, unknown> | null | undefined;
  if (role === null || typeof role !== "object") {
    errors.push("role must be an object");
  } else {
    for (const key of V12_ROLE_KEYS) {
      if (!isNonEmptyString(role[key])) {
        errors.push(`role.${key} must be a non-empty string`);
      }
    }
    for (const key of Object.keys(role)) {
      if (!(V12_ROLE_KEYS as readonly string[]).includes(key)) {
        errors.push(`unknown role field: ${key}`);
      }
    }
  }

  validateSelectivityCuts(raw.selectivityCuts, errors);

  const thresholds = raw.thresholds as Record<string, unknown> | null | undefined;
  if (thresholds === null || typeof thresholds !== "object") {
    errors.push("thresholds must be an object");
  } else {
    for (const key of ["classConfidence", "dimensionConfidence"] as const) {
      const value = thresholds[key];
      if (!isFiniteNumber(value)) errors.push(`thresholds.${key} must be a finite number`);
      else if (value < 0 || value > 1) {
        errors.push(`thresholds.${key} must be in [0, 1] (got ${value})`);
      }
    }
  }
}

function isCareerEvidenceV12(
  spec: CareerEvidenceSpec | CareerEvidenceV11Spec | CareerEvidenceV12Spec,
): spec is CareerEvidenceV12Spec {
  return (
    spec.version === "1.2.0" ||
    spec.version === "1.2.1" ||
    spec.version === "1.2.2" ||
    "pool_strength" in spec ||
    "scale" in spec ||
    "role" in spec
  );
}

function isCareerEvidenceV11(
  spec: CareerEvidenceSpec | CareerEvidenceV11Spec,
): spec is CareerEvidenceV11Spec {
  return "selectivityCuts" in spec;
}

function validateCareerEvidenceSpec(spec: CareerEvidenceSpec, errors: string[]): void {
  if (!isNonEmptyString(spec.model)) errors.push("model must be a non-empty string");

  validateCareerEvidenceLevels(spec, errors);
  validateCareerEvidenceQuestions(spec, errors);

  const criteria = spec.eventCriteria as Record<string, unknown> | null | undefined;
  if (criteria === null || typeof criteria !== "object") {
    errors.push("eventCriteria must be an object keyed by event kind");
  } else {
    for (const kind of EVENT_CRITERIA_KEYS) {
      if (!isNonEmptyString(criteria[kind])) {
        errors.push(`eventCriteria.${kind} must be a non-empty string`);
      }
    }
    for (const key of Object.keys(criteria)) {
      if (!EVENT_CRITERIA_KEYS.includes(key))
        errors.push(`unknown event kind in eventCriteria: ${key}`);
    }
  }

  const thresholds = spec.thresholds as Record<string, unknown> | null | undefined;
  if (thresholds === null || typeof thresholds !== "object") {
    errors.push("thresholds must be an object");
  } else {
    for (const key of EVIDENCE_THRESHOLD_KEYS) {
      const value = thresholds[key];
      if (!isFiniteNumber(value)) errors.push(`thresholds.${key} must be a finite number`);
      else if (value < 0 || value > 1) {
        errors.push(`thresholds.${key} must be in [0, 1] (got ${value})`);
      }
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
    case "career_evidence":
      if (isCareerEvidenceV12(spec)) validateCareerEvidenceV12Spec(spec, errors);
      else if (isCareerEvidenceV11(spec)) validateCareerEvidenceV11Spec(spec, errors);
      else validateCareerEvidenceSpec(spec, errors);
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
