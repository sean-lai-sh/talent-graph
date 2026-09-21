/**
 * What `validateSpec` refuses, and what the pipeline policy reads off a spec.
 *
 * The wording *is* the spec, so a rubric that is not the shared 0..MAX_LEVEL
 * scale, a taxonomy missing the no-event escape hatch, or a threshold outside
 * [0, 1] is not a spec with a warning on it — it is rejected by name. The
 * policy is then a pure function of the spec it validated.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "../src/longitudinal/dimensions.ts";
import { DEFAULT_EVIDENCE_POLICY } from "../src/longitudinal/policy.ts";
import { CAREER_EVIDENCE_V1_0_0 } from "../src/models/careerEvidence.ts";
import type { CareerEvidenceSpec } from "../src/models/spec.ts";
import { validateSpec } from "../src/models/spec.ts";

const _ROOT = join(import.meta.dir, "..");

/**
 * The hash of the wording that shipped. If this line has to change, every
 * career event already stamped `career-evidence@1.0.0` has become
 * unreproducible — ship a new spec version instead of editing this one.
 */
const _PINNED_RUBRIC_HASH = "6290bc28b1a9b5a61ecab7dc389203daf1d4527a5b1b5c7d20866a34e26bac97";

const spec = CAREER_EVIDENCE_V1_0_0;

/** A structurally-typed clone of the frozen spec, safe to mutate in a test. */
function mutableSpec(): CareerEvidenceSpec {
  return structuredClone(spec) as CareerEvidenceSpec;
}

/** The clone's `levels`, seen as the mutable map a broken spec would carry. */
function levelsOf(candidate: CareerEvidenceSpec): Record<string, string[]> {
  return candidate.levels as unknown as Record<string, string[]>;
}

function errorsOf(candidate: CareerEvidenceSpec): string[] {
  const result = validateSpec(candidate);
  return result.ok ? [] : result.errors;
}

describe("CareerEvidenceSpec: validateSpec rejections", () => {
  test("a missing dimension is rejected", () => {
    const broken = mutableSpec();
    delete levelsOf(broken).peer_validation;
    expect(errorsOf(broken)).toContain(
      "levels.peer_validation is missing; every dimension needs a rubric",
    );
  });

  test("a missing dimension question is rejected", () => {
    const broken = mutableSpec();
    delete (broken.questions.dimensions as Record<string, unknown>).originality;
    expect(errorsOf(broken)).toContain(
      "questions.dimensions.originality must be a non-empty string",
    );
  });

  test("a one-level rubric is rejected", () => {
    const broken = mutableSpec();
    levelsOf(broken).difficulty = [spec.levels.difficulty[0]];
    expect(errorsOf(broken)).toContain("levels.difficulty must have at least 2 levels (got 1)");
  });

  test("unequal level counts across dimensions are rejected", () => {
    const broken = mutableSpec();
    levelsOf(broken).ownership = [...spec.levels.ownership].slice(0, 3);
    expect(errorsOf(broken)).toContain(
      "levels.ownership has 3 levels; every dimension must share one scale (5)",
    );
  });

  test("a rubric that is not the shared 0..MAX_LEVEL scale is rejected, even when every dimension agrees", () => {
    // Six levels everywhere: the ">= 2" and "equal across dimensions" rules
    // both pass, so only the exact-length rule can catch it. `careerEvidenceVector`
    // still divides by the fixed MAX_LEVEL, so a level 5 would normalise to
    // 1.25 — a value outside [0, 1] that no downstream reader expects.
    const broken = mutableSpec();
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      levelsOf(broken)[dimension] = [...spec.levels[dimension], "A sixth level."];
    }
    expect(errorsOf(broken)).toContain(
      `levels.difficulty has 6 levels; the shared scale is 0..${MAX_LEVEL}, so it must have ${MAX_LEVEL + 1}`,
    );
  });

  test("a two-level rubric on every dimension is rejected for the same reason", () => {
    // Structurally fine under the generic rules; normalised scores would never
    // exceed 0.25 because the divisor is still the fixed MAX_LEVEL.
    const broken = mutableSpec();
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      levelsOf(broken)[dimension] = [...spec.levels[dimension]].slice(0, 2);
    }
    const errors = errorsOf(broken);
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      expect(errors).toContain(
        `levels.${dimension} has 2 levels; the shared scale is 0..${MAX_LEVEL}, so it must have ${MAX_LEVEL + 1}`,
      );
    }
  });

  test("an event taxonomy missing no_supported_event is rejected", () => {
    const broken = mutableSpec();
    delete (broken.eventCriteria as Record<string, unknown>).no_supported_event;
    expect(errorsOf(broken)).toContain(
      "eventCriteria.no_supported_event must be a non-empty string",
    );
  });

  test("an event taxonomy missing a career event kind is rejected", () => {
    const broken = mutableSpec();
    delete (broken.eventCriteria as Record<string, unknown>).grant_or_award;
    expect(errorsOf(broken)).toContain("eventCriteria.grant_or_award must be a non-empty string");
  });

  test("a threshold outside [0, 1] is rejected, on either side", () => {
    const above = mutableSpec();
    above.thresholds.eventConfidence = 1.5;
    expect(errorsOf(above)).toContain("thresholds.eventConfidence must be in [0, 1] (got 1.5)");

    const below = mutableSpec();
    below.thresholds.identityContradiction = -0.1;
    expect(errorsOf(below)).toContain(
      "thresholds.identityContradiction must be in [0, 1] (got -0.1)",
    );
  });

  test("a non-finite threshold is rejected rather than read as zero", () => {
    const broken = mutableSpec();
    (broken.thresholds as Record<string, unknown>).dimensionConfidence = undefined;
    expect(errorsOf(broken)).toContain("thresholds.dimensionConfidence must be a finite number");
  });

  test("an unknown key in the levels or the taxonomy is rejected", () => {
    const broken = mutableSpec();
    levelsOf(broken).charisma = ["a", "b", "c", "d", "e"];
    (broken.eventCriteria as Record<string, unknown>).went_viral = "no";
    const errors = errorsOf(broken);
    expect(errors).toContain("unknown dimension in levels: charisma");
    expect(errors).toContain("unknown event kind in eventCriteria: went_viral");
  });

  test("a non-semver version is rejected", () => {
    const broken = mutableSpec();
    broken.version = "one";
    expect(errorsOf(broken).join("; ")).toContain("version must be a semver string");
  });
});

describe("CareerEvidenceSpec: the pipeline policy reads the spec", () => {
  test("DEFAULT_EVIDENCE_POLICY thresholds are the spec's, and the stamp is unchanged", () => {
    expect(DEFAULT_EVIDENCE_POLICY).toEqual({
      identityConfidence: 0.75,
      identityContradiction: 0.25,
      eventConfidence: 0.65,
      dimensionConfidence: 0.5,
      questionVersion: "career_evidence@1.0.0",
      model: "jev",
    });
    expect(spec.thresholds).toEqual({
      identityConfidence: 0.75,
      identityContradiction: 0.25,
      eventConfidence: 0.65,
      dimensionConfidence: 0.5,
    });
  });
});
