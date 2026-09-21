/**
 * The registered career-evidence spec, and the three ways a test bends it.
 *
 * Shared rather than copied: #54 T8 split the spec suite into registration,
 * validation and adapter files, and all three want the same frozen constant,
 * the same mutable clone of it and the same view of its `levels`. A second
 * copy of `mutableSpec` would let one file's idea of "the spec, with one
 * field broken" drift from another's — and would need a second copy of the
 * one assertion below.
 */

import { CAREER_EVIDENCE_V1_0_0 } from "../../src/models/careerEvidence.ts";
import type { CareerEvidenceSpec } from "../../src/models/spec.ts";
import { validateSpec } from "../../src/models/spec.ts";

/**
 * The hash of the wording that shipped. If this line has to change, every
 * career event already stamped `career_evidence@1.0.0` has become
 * unreproducible — ship a new spec version instead of editing this one.
 */
export const PINNED_RUBRIC_HASH =
  "6290bc28b1a9b5a61ecab7dc389203daf1d4527a5b1b5c7d20866a34e26bac97";

export const spec = CAREER_EVIDENCE_V1_0_0;

/** A structurally-typed clone of the frozen spec, safe to mutate in a test. */
export function mutableSpec(): CareerEvidenceSpec {
  return structuredClone(spec) as CareerEvidenceSpec;
}

/**
 * The clone's `levels`, seen as the mutable map a broken spec would carry.
 *
 * `levels` is `Record<CareerEvidenceDimension, readonly [string, string,
 * ...string[]]>`, and the point of every caller is to put something in it that
 * the type forbids — a missing dimension, a one-entry rubric, an unknown key.
 * That view is the one assertion this file makes, named and in one place, so
 * no test has to spell it again.
 */
export function levelsOf(candidate: CareerEvidenceSpec): Record<string, string[]> {
  return candidate.levels as unknown as Record<string, string[]>;
}

/** What `validateSpec` says about a candidate, as a plain list of messages. */
export function errorsOf(candidate: CareerEvidenceSpec): string[] {
  const result = validateSpec(candidate);
  return result.ok ? [] : result.errors;
}
