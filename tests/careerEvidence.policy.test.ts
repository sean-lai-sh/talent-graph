/**
 * The evidence policy as a table, with no service of any kind.
 *
 * `gateIdentity` and `decideStatus` are pure, so the policy is a function of
 * five inputs — identity decision, identity confidence, the three field
 * matches, event confidence and the weakest dimension confidence — and can be
 * read off one table instead of four round trips through a fake judgment
 * service. The round trips that remain in `tests/longitudinal.test.ts` are the
 * ones where the trip itself is under test (that `assessClaim` is not called).
 */

import { describe, expect, test } from "bun:test";
import type { ClaimAssessment, IdentityAssessment } from "../src/longitudinal/judgments.ts";
import type { EvidenceThresholds } from "../src/longitudinal/stages.ts";
import { decideStatus, gateIdentity, selectEligible } from "../src/longitudinal/stages.ts";
import type {
  ClaimStatus,
  GrokEvidenceItem,
  IdentityDecision,
  ReviewReason,
} from "../src/longitudinal/types.ts";

/** Stated here, not loaded: this table pins these numbers, not the defaults. */
const thresholds: EvidenceThresholds = {
  identityConfidence: 0.75,
  identityContradiction: 0.25,
  eventConfidence: 0.65,
  dimensionConfidence: 0.5,
};

interface Row {
  identityDecision: IdentityDecision;
  identityConfidence: number;
  /** `[name, affiliation, handle]`. */
  fieldMatches: [number, number, number];
  eventConfidence: number;
  /**
   * The weakest dimension confidence, with the other four at 1. `null` means
   * the assessment carried no dimension judgments at all.
   */
  minDimensionConfidence: number | null;
  expected: { gate: "pass" | "stop"; status: ClaimStatus; reasons: ReviewReason[] };
}

const row = (
  identityDecision: IdentityDecision,
  identityConfidence: number,
  fieldMatches: [number, number, number],
  eventConfidence: number,
  minDimensionConfidence: number | null,
  gate: "pass" | "stop",
  status: ClaimStatus,
  reasons: ReviewReason[],
): Row => ({
  identityDecision,
  identityConfidence,
  fieldMatches,
  eventConfidence,
  minDimensionConfidence,
  expected: { gate, status, reasons },
});

const clean: [number, number, number] = [0.99, 0.8, 1];

const table: Row[] = [
  // Identity settles first; the event grounds are never reached when it stops.
  row("different", 0.97, [0.1, 0.1, 0.05], 0.92, 1, "stop", "rejected", []),
  row("different", 0.2, [1, 1, 1], 0.4, null, "stop", "rejected", []),
  row("review", 0.55, [0.6, 0.5, 0.4], 0.92, 1, "stop", "review", ["identity_ambiguous"]),
  row("review", 0.99, [1, 1, 1], 0.92, 1, "stop", "review", ["identity_ambiguous"]),
  row("same", 0.6, clean, 0.92, 1, "stop", "review", ["identity_low_confidence"]),
  row("same", 0.75, clean, 0.92, 1, "pass", "accepted", []),
  row("same", 0.98, [0.92, 0.04, 0.02], 0.92, 1, "stop", "review", [
    "identity_contradictory_fields",
  ]),
  // A field match exactly at the contradiction threshold is not contradictory.
  row("same", 0.98, [0.25, 1, 1], 0.92, 1, "pass", "accepted", []),
  // A missing field match is not a matching one: absence never reads as zero,
  // and it never reads as agreement either.
  row("same", 0.98, [Number.NaN, 1, 1], 0.92, 1, "stop", "review", [
    "identity_contradictory_fields",
  ]),
  row("same", 0.6, [0.92, 0.04, 0.02], 0.92, 1, "stop", "review", [
    "identity_low_confidence",
    "identity_contradictory_fields",
  ]),
  // Event grounds, with identity settled as `same` and confident.
  row("same", 0.98, clean, 0.92, 1, "pass", "accepted", []),
  row("same", 0.98, clean, 0.65, 0.5, "pass", "accepted", []),
  row("same", 0.98, clean, 0.4, 1, "pass", "review", ["event_low_confidence"]),
  row("same", 0.98, clean, 0.92, 0.2, "pass", "review", ["dimension_low_confidence"]),
  row("same", 0.98, clean, 0.4, 0.2, "pass", "review", [
    "event_low_confidence",
    "dimension_low_confidence",
  ]),
  row("same", 0.98, clean, 0.92, null, "pass", "review", ["no_dimensions"]),
  row("same", 0.98, clean, 0.4, null, "pass", "review", ["event_low_confidence", "no_dimensions"]),
];

function identityOf(item: Row): IdentityAssessment {
  const [name, affiliation, handle] = item.fieldMatches;
  return {
    decision: item.identityDecision,
    confidence: item.identityConfidence,
    fieldMatches: { name, affiliation, handle },
  };
}

function assessmentOf(item: Row): ClaimAssessment {
  const dimensions: ClaimAssessment["dimensions"] =
    item.minDimensionConfidence === null
      ? []
      : [
          { dimension: "difficulty", score: 3, probabilities: [0, 0, 0.2, 0.8, 0], confidence: 1 },
          { dimension: "ownership", score: 4, probabilities: [0, 0, 0, 0, 1], confidence: 1 },
          {
            dimension: "external_impact",
            score: 2,
            probabilities: [0, 0, 1, 0, 0],
            confidence: 1,
          },
          { dimension: "originality", score: 3, probabilities: [0, 0, 0, 1, 0], confidence: 1 },
          {
            dimension: "peer_validation",
            score: 2,
            probabilities: [0, 0, 1, 0, 0],
            confidence: item.minDimensionConfidence,
          },
        ];
  return {
    eventKind: "open_source_contribution",
    eventConfidence: item.eventConfidence,
    dimensions,
  };
}

describe("career evidence policy: gateIdentity and decideStatus", () => {
  test("one table over identity, field matches, event and dimension confidence", () => {
    const actual = table.map((item) => {
      const identity = identityOf(item);
      const gate = gateIdentity(identity, thresholds);
      // A stopped gate is the whole decision: the assessment is never made, so
      // `decideStatus` is asked the same question the pipeline asks it.
      const assessment = gate.kind === "stop" ? null : assessmentOf(item);
      const decision = decideStatus(identity, assessment, thresholds);
      return { gate: gate.kind, status: decision.status, reasons: decision.reasons };
    });
    expect(actual).toEqual(table.map((item) => item.expected));
  });

  test("a stopped gate carries the same status and reasons the decision does", () => {
    for (const item of table) {
      const identity = identityOf(item);
      const gate = gateIdentity(identity, thresholds);
      if (gate.kind !== "stop") continue;
      expect(gate.status).toBe(item.expected.status as "rejected" | "review");
      expect(gate.reasons).toEqual(item.expected.reasons);
    }
  });

  test("an assessment that never arrived is review, never an accepted zero", () => {
    const identity: IdentityAssessment = {
      decision: "same",
      confidence: 0.98,
      fieldMatches: { name: 0.99, affiliation: 0.8, handle: 1 },
    };
    expect(decideStatus(identity, null, thresholds)).toEqual({
      status: "review",
      reasons: ["judgment_unavailable"],
    });
  });

  test("an assessed kind of null is rejected and carries no reasons", () => {
    const identity: IdentityAssessment = {
      decision: "same",
      confidence: 0.98,
      fieldMatches: { name: 0.99, affiliation: 0.8, handle: 1 },
    };
    const assessment: ClaimAssessment = {
      ...assessmentOf(table[10] as Row),
      eventKind: null,
    };
    expect(decideStatus(identity, assessment, thresholds)).toEqual({
      status: "rejected",
      reasons: [],
    });
  });
});

describe("career evidence policy: selectEligible", () => {
  const at = (iso: string, sourceId: string): GrokEvidenceItem => ({
    source: "github",
    sourceId,
    url: `https://github.com/avery/${sourceId}`,
    publisher: "avery",
    publishedAt: iso,
    quotedText: "",
    contentHash: `hash-${sourceId}`,
    statement: sourceId,
    proposedEventKind: null,
  });

  test("the baseline is exclusive, the cutoff inclusive, and ties break by sourceId", () => {
    const eligible = selectEligible(
      [
        at("2026-04-01T00:00:00.000Z", "after-cutoff"),
        at("2026-02-01T00:00:00.000Z", "b-same-instant"),
        at("2026-01-01T00:00:00.000Z", "at-baseline"),
        at("2026-02-01T00:00:00.000Z", "a-same-instant"),
        at("2026-03-01T00:00:00.000Z", "at-cutoff"),
      ],
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-03-01T00:00:00.000Z"),
    );
    expect(eligible.map((item) => item.sourceId)).toEqual([
      "a-same-instant",
      "b-same-instant",
      "at-cutoff",
    ]);
  });

  test("no baseline keeps everything up to the cutoff", () => {
    const eligible = selectEligible(
      [at("2025-01-01T00:00:00.000Z", "old"), at("2026-04-01T00:00:00.000Z", "after-cutoff")],
      undefined,
      new Date("2026-03-01T00:00:00.000Z"),
    );
    expect(eligible.map((item) => item.sourceId)).toEqual(["old"]);
  });
});
