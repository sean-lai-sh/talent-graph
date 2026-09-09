/**
 * Runtime guards for raw observation records.
 *
 * Every validator is pure and returns a result object; none of them throw and
 * none of them compute a score.
 */

import { DIMENSIONS, EVIDENCE_TYPES } from "./constants.ts";
import type {
  Comparison,
  Dimension,
  Evaluation,
  EvidenceType,
  Opportunity,
  Outcome,
  Referral,
} from "./types.ts";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

function result(errors: string[]): ValidationResult {
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function isScale5(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

function isRubricScore(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
}

export function isDimension(value: unknown): value is Dimension {
  return typeof value === "string" && (DIMENSIONS as readonly string[]).includes(value);
}

export function isEvidenceType(value: unknown): value is EvidenceType {
  return typeof value === "string" && (EVIDENCE_TYPES as readonly string[]).includes(value);
}

/**
 * A referral is valid when nobody refers themselves, all three sliders are
 * integers in 1..5, the (referrer, candidate) pair is new, and the referrer
 * wrote down what they observed.
 */
export function validateReferral(
  r: Referral,
  existing: readonly Referral[] = [],
): ValidationResult {
  const errors: string[] = [];

  if (r.referrerId === r.candidateId) {
    errors.push("referrerId must differ from candidateId (no self-referral)");
  }
  if (!isScale5(r.conviction)) errors.push("conviction must be an integer in 1..5");
  if (!isScale5(r.confidence)) errors.push("confidence must be an integer in 1..5");
  if (!isScale5(r.relationshipDepth)) errors.push("relationshipDepth must be an integer in 1..5");
  if (!isEvidenceType(r.evidenceType))
    errors.push(`unknown evidenceType: ${String(r.evidenceType)}`);
  if (typeof r.evidenceText !== "string" || r.evidenceText.trim() === "") {
    errors.push("evidenceText must be non-empty");
  }

  const duplicate = existing.some(
    (other) =>
      other.id !== r.id && other.referrerId === r.referrerId && other.candidateId === r.candidateId,
  );
  if (duplicate) {
    errors.push(`duplicate referral from ${r.referrerId} to ${r.candidateId}`);
  }

  return result(errors);
}

/**
 * A rubric evaluation is valid when the score is N/O (null) or an integer in
 * 0..4, and confidence is null or 1..5. An unobserved score cannot carry a
 * confidence: there is nothing to be confident about.
 */
export function validateEvaluation(e: Evaluation): ValidationResult {
  const errors: string[] = [];

  if (!isDimension(e.dimension)) errors.push(`unknown dimension: ${String(e.dimension)}`);
  if (e.score !== null && !isRubricScore(e.score)) {
    errors.push("score must be null (N/O) or an integer in 0..4");
  }
  if (e.confidence !== null && !isScale5(e.confidence)) {
    errors.push("confidence must be null or an integer in 1..5");
  }
  if (e.score === null && e.confidence !== null) {
    errors.push("confidence must be null when score is null (N/O)");
  }

  return result(errors);
}

export interface ValidateComparisonOptions {
  allowSelfEvaluation?: boolean;
}

/**
 * A comparison is valid when it compares two distinct people on a known
 * dimension, the winner matches the outcome, and the evaluator is not one of
 * the two people being compared.
 */
export function validateComparison(
  c: Comparison,
  opts: ValidateComparisonOptions = {},
): ValidationResult {
  const errors: string[] = [];

  if (c.personAId === c.personBId) errors.push("personAId must differ from personBId");
  if (!isDimension(c.dimension)) errors.push(`unknown dimension: ${String(c.dimension)}`);

  switch (c.outcome) {
    case "a":
      if (c.winnerId !== c.personAId)
        errors.push('winnerId must equal personAId when outcome is "a"');
      break;
    case "b":
      if (c.winnerId !== c.personBId)
        errors.push('winnerId must equal personBId when outcome is "b"');
      break;
    case "tie":
    case "skip":
    case "insufficient_observation":
      if (c.winnerId !== null) errors.push(`winnerId must be null when outcome is "${c.outcome}"`);
      break;
    default:
      errors.push(`unknown outcome: ${String(c.outcome)}`);
  }

  if (c.confidence !== null && !isScale5(c.confidence)) {
    errors.push("confidence must be null or an integer in 1..5");
  }

  if (
    opts.allowSelfEvaluation !== true &&
    (c.evaluatorId === c.personAId || c.evaluatorId === c.personBId)
  ) {
    errors.push("evaluatorId may not be one of the compared people");
  }

  return result(errors);
}

/**
 * An outcome is valid when it names a person and a kind, its value is null or
 * a finite number, and `observedAt` is a real date. Observations may be
 * back-filled, so `observedAt` is allowed to precede `createdAt`.
 */
export function validateOutcome(o: Outcome): ValidationResult {
  const errors: string[] = [];
  if (typeof o.personId !== "string" || o.personId === "")
    errors.push("personId must be non-empty");
  if (typeof o.kind !== "string" || o.kind.trim() === "") errors.push("kind must be non-empty");
  if (o.value !== null && !(typeof o.value === "number" && Number.isFinite(o.value))) {
    errors.push("value must be null or a finite number");
  }
  if (!(o.observedAt instanceof Date) || Number.isNaN(o.observedAt.getTime())) {
    errors.push("observedAt must be a valid Date");
  }
  return result(errors);
}

/** An opportunity is valid when it names a person, has a kind, and ends no earlier than it starts. */
export function validateOpportunity(o: Opportunity): ValidationResult {
  const errors: string[] = [];
  if (typeof o.personId !== "string" || o.personId === "")
    errors.push("personId must be non-empty");
  if (typeof o.kind !== "string" || o.kind.trim() === "") errors.push("kind must be non-empty");
  const validStart = o.startedAt instanceof Date && !Number.isNaN(o.startedAt.getTime());
  if (!validStart) errors.push("startedAt must be a valid Date");
  if (o.endedAt !== null) {
    const validEnd = o.endedAt instanceof Date && !Number.isNaN(o.endedAt.getTime());
    if (!validEnd) errors.push("endedAt must be null or a valid Date");
    else if (validStart && o.endedAt.getTime() < o.startedAt.getTime()) {
      errors.push("endedAt must not precede startedAt");
    }
  }
  return result(errors);
}
