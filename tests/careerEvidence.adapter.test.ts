/**
 * The adapter builds every question from the spec, and only from the spec.
 *
 * Nothing the model is asked is written in the adapter, so a judgment stamped
 * with a spec version can be reproduced from that version alone. The requests
 * are captured byte for byte and compared against the fixture taken before the
 * adapter took the spec as an argument.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createJevJudgmentService } from "../apps/club/lib/longitudinal/jev.ts";
import { CAREER_EVIDENCE_DIMENSIONS } from "../src/longitudinal/dimensions.ts";
import type { CanonicalIdentity, GrokEvidenceItem } from "../src/longitudinal/types.ts";
import { CAREER_EVENT_KINDS } from "../src/longitudinal/types.ts";
import { CAREER_EVIDENCE_V1_0_0 } from "../src/models/careerEvidence.ts";
import type { CareerEvidenceSpec } from "../src/models/spec.ts";
import { validateSpec } from "../src/models/spec.ts";
import { recordingClient } from "./helpers/records.ts";

const ROOT = join(import.meta.dir, "..");

/**
 * The hash of the wording that shipped. If this line has to change, every
 * career event already stamped `career-evidence@1.0.0` has become
 * unreproducible — ship a new spec version instead of editing this one.
 */
const _PINNED_RUBRIC_HASH = "6290bc28b1a9b5a61ecab7dc389203daf1d4527a5b1b5c7d20866a34e26bac97";

const spec = CAREER_EVIDENCE_V1_0_0;

/** A structurally-typed clone of the frozen spec, safe to mutate in a test. */
function _mutableSpec(): CareerEvidenceSpec {
  return structuredClone(spec) as CareerEvidenceSpec;
}

/** The clone's `levels`, seen as the mutable map a broken spec would carry. */
function _levelsOf(candidate: CareerEvidenceSpec): Record<string, string[]> {
  return candidate.levels as unknown as Record<string, string[]>;
}

function _errorsOf(candidate: CareerEvidenceSpec): string[] {
  const result = validateSpec(candidate);
  return result.ok ? [] : result.errors;
}

/**
 * The adapter's questions, captured. The client is `recordingClient`, whose
 * answers are typed against the SDK's result type (tests/helpers/records.ts);
 * what these tests read is the request it was handed, not the answer.
 */
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
  await service.assessClaim(evidence, identity.personId);
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
