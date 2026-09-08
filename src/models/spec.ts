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

export type ModelSpec = ReferralSignalSpec | BradleyTerrySpec;

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
    default:
      errors.push(`unknown spec kind: ${String((spec as ModelSpec).kind)}`);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** Stable identifier for a spec, used in ModelRun records and drift reports. */
export function specId(spec: ModelSpec): string {
  return `${spec.kind}@${spec.version}`;
}
