/**
 * The career-evidence rubric as a registered spec.
 *
 * The wording *is* the spec: a reworded level description changes what an
 * answer means, so `CAREER_EVIDENCE_V1_0_0` carries the text that shipped and
 * these tests pin it three ways — the rubric hash, the id derived from it, and
 * the requests the Club adapter actually sends, captured from the adapter
 * before it took the spec as an argument.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createJevJudgmentService } from "../apps/club/lib/longitudinal/jev.ts";
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "../src/longitudinal/dimensions.ts";
import { DEFAULT_EVIDENCE_POLICY } from "../src/longitudinal/pipeline.ts";
import type { CanonicalIdentity, GrokEvidenceItem } from "../src/longitudinal/types.ts";
import { CAREER_EVENT_KINDS } from "../src/longitudinal/types.ts";
import { CAREER_EVIDENCE_V1_0_0, isRegisteredSpec } from "../src/models/registry.ts";
import type { CareerEvidenceSpec } from "../src/models/spec.ts";
import {
  careerEvidenceRubricHash,
  careerEvidenceSpecId,
  validateSpec,
} from "../src/models/spec.ts";

const ROOT = join(import.meta.dir, "..");

/**
 * The hash of the wording that shipped. If this line has to change, every
 * career event already stamped `career-evidence@1.0.0` has become
 * unreproducible — ship a new spec version instead of editing this one.
 */
const PINNED_RUBRIC_HASH = "6290bc28b1a9b5a61ecab7dc389203daf1d4527a5b1b5c7d20866a34e26bac97";

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

describe("CareerEvidenceSpec: registration", () => {
  test("the registered spec validates and is registered by id and by value", () => {
    expect(validateSpec(spec)).toEqual({ ok: true });
    expect(isRegisteredSpec(spec)).toBe(true);
  });

  test("the rubric hash is the wording that shipped", () => {
    expect(careerEvidenceRubricHash(spec)).toBe(PINNED_RUBRIC_HASH);
  });

  test("the spec id carries the version and the first eight hash digits", () => {
    expect(careerEvidenceSpecId(spec)).toBe(
      `career_evidence@1.0.0:${PINNED_RUBRIC_HASH.slice(0, 8)}`,
    );
  });

  test("editing one character of one level description changes the spec id", () => {
    const edited = mutableSpec();
    const rubric = levelsOf(edited).ownership as string[];
    const original = rubric[0] as string;
    rubric[0] = `${original.slice(0, -1)}!`;
    expect(rubric[0]).not.toBe(original);
    expect(rubric[0]).toHaveLength(original.length);
    expect(careerEvidenceSpecId(edited)).not.toBe(careerEvidenceSpecId(spec));
    // The version did not move; only the hash caught it.
    expect(edited.version).toBe(spec.version);
  });

  test("the spec is deeply frozen, so a level cannot be edited in place", () => {
    expect(Object.isFrozen(spec.levels.difficulty)).toBe(true);
    expect(Object.isFrozen(spec.eventCriteria)).toBe(true);
    expect(Object.isFrozen(spec.thresholds)).toBe(true);
  });

  test("the shared 0..MAX_LEVEL scale is the rubric length, for every dimension", () => {
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      expect(spec.levels[dimension]).toHaveLength(MAX_LEVEL + 1);
    }
  });

  test("docs/models/CHANGELOG.md carries the career_evidence@1.0.0 entry", () => {
    const changelog = readFileSync(join(ROOT, "docs/models/CHANGELOG.md"), "utf8");
    expect(changelog).toContain("## career_evidence@1.0.0");
    expect(changelog).toContain("- **Drift:**");
  });
});

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
      questionVersion: "career-evidence@1.0.0",
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

/** Records every request the adapter sends, and answers plausibly. */
function recordingClient(requests: unknown[]): Parameters<typeof createJevJudgmentService>[0] {
  const level = { score: 3, probabilities: { 0: 0, 1: 0, 2: 0.2, 3: 0.8, 4: 0 }, confidence: 0.8 };
  return {
    async systemOne(request: unknown) {
      requests.push(request);
      return {
        answers: {
          decision: { choice: "same", confidence: 0.98, probabilities: {} },
          same_name: { noul: 0.99 },
          same_affiliation: { noul: 0.8 },
          same_handle: { noul: 1 },
          event_kind: { choice: "shipped_product", confidence: 0.9, probabilities: {} },
          difficulty: level,
          ownership: level,
          external_impact: level,
          originality: level,
          peer_validation: level,
        },
      };
    },
  } as unknown as Parameters<typeof createJevJudgmentService>[0];
}

const identity: CanonicalIdentity = {
  personId: "person-1",
  name: "Avery Chen",
  aliases: ["A. Chen"],
  externalIdentities: [
    {
      source: "github",
      externalId: "averyc",
      url: "https://github.com/averyc",
      verifiedAt: null,
    },
  ],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const evidence: GrokEvidenceItem = {
  source: "github",
  sourceId: "item-1",
  url: "https://github.com/averyc/toolkit/releases/tag/v2.0.0",
  publisher: "averyc",
  publishedAt: "2026-02-01T00:00:00.000Z",
  quotedText: "v2.0.0 ships the streaming planner.",
  contentHash: "hash-item-1",
  statement: "Avery Chen released v2.0.0 of the toolkit.",
  proposedEventKind: "shipped_product",
};

async function capture(): Promise<{ identity: unknown; claim: unknown }> {
  const requests: unknown[] = [];
  const service = createJevJudgmentService(recordingClient(requests));
  await service.assessIdentity(identity, evidence);
  await service.assessClaim(evidence);
  expect(requests).toHaveLength(2);
  return { identity: requests[0], claim: requests[1] };
}

describe("CareerEvidenceSpec: the adapter builds its questions from the spec", () => {
  test("every question the adapter sends matches the spec field-for-field", async () => {
    const sent = (await capture()) as {
      identity: { questions: Record<string, { instructions: string; criteria?: unknown }> };
      claim: { questions: Record<string, { instructions: string; criteria?: unknown }> };
    };
    const iq = sent.identity.questions;
    const cq = sent.claim.questions;

    expect(iq.decision?.instructions).toBe(spec.questions.identityDecision);
    expect(iq.decision?.criteria).toEqual({
      different: spec.questions.identity[0],
      review: spec.questions.identity[1],
      same: spec.questions.identity[2],
    });
    expect(iq.same_name?.instructions).toBe(spec.questions.identityFields.name);
    expect(iq.same_affiliation?.instructions).toBe(spec.questions.identityFields.affiliation);
    expect(iq.same_handle?.instructions).toBe(spec.questions.identityFields.handle);
    // Order is part of what is sent: the identity questions in this order.
    expect(Object.keys(iq)).toEqual(["decision", "same_name", "same_affiliation", "same_handle"]);

    expect(cq.event_kind?.instructions).toBe(spec.questions.eventKind);
    expect(cq.event_kind?.criteria).toEqual(spec.eventCriteria);
    expect(Object.keys(cq.event_kind?.criteria as object)).toEqual([
      ...CAREER_EVENT_KINDS,
      "no_supported_event",
    ]);
    for (const dimension of CAREER_EVIDENCE_DIMENSIONS) {
      expect(cq[dimension]?.instructions).toBe(spec.questions.dimensions[dimension]);
      expect(cq[dimension]?.criteria).toEqual(spec.levels[dimension] as unknown as string[]);
    }
    expect(Object.keys(cq)).toEqual(["event_kind", ...CAREER_EVIDENCE_DIMENSIONS]);
  });

  test("the requests are byte-identical to the ones captured before the refactor", async () => {
    const recorded = readFileSync(
      join(ROOT, "tests/fixtures/longitudinal-jev-request.json"),
      "utf8",
    );
    // Compact, order-sensitive: `toBe` on the one-line form compares the key
    // order the SDK is handed, not just the set of keys a deep-equal would.
    expect(JSON.stringify(await capture())).toBe(JSON.stringify(JSON.parse(recorded)));
  });
});
