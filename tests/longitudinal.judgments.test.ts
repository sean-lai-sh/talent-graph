/**
 * The evidence policy through the pipeline: what a judgment round trip does.
 *
 * The policy *table* is `tests/careerEvidence.policy.test.ts`, which needs no
 * service at all. What is left here is the round trip itself — that
 * `assessClaim` is never called once identity has stopped an item, that Grok's
 * proposed kind and Jev's assessed kind stay apart, and that a missing
 * dimension becomes a recorded absence rather than a zero.
 */

import { describe, expect, test } from "bun:test";
import type { EvidenceClaim } from "../src/index.ts";
import {
  careerEventsToLongitudinalRecords,
  processEvidence,
  validateEvidenceClaim,
} from "../src/index.ts";
import {
  acceptingJudgments,
  day,
  event,
  evidence,
  type FakeJudgments,
  identity,
  serviceOf,
} from "./helpers/longitudinal.ts";

describe("Jev judgments through the pipeline", () => {
  test("an ambiguous identity stops before assessClaim is ever called", async () => {
    let assessClaimCalls = 0;
    const ambiguous: FakeJudgments = {
      async assessIdentity() {
        return {
          decision: "review",
          confidence: 0.55,
          fieldMatches: { name: 0.6, affiliation: 0.5, handle: 0.4 },
        };
      },
      async assessClaim(item) {
        assessClaimCalls++;
        return acceptingJudgments.assessClaim(item);
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(ambiguous),
    });
    expect(assessClaimCalls).toBe(0);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.status).toBe("review");
    expect(result.claims[0]?.identityDecision).toBe("review");
    expect(result.claims[0]?.reviewReasons).toContain("identity_ambiguous");
    expect(result.claims[0]?.assessedEventKind).toBe(null);
    expect(result.claims[0]?.proposedEventKind).toBe("open_source_contribution");
    expect(result.events).toHaveLength(0);
    expect(result.needsReview).toBe(true);
    expect(careerEventsToLongitudinalRecords(result.events).outcomes).toEqual([]);
  });

  test("an assessed claim keeps Grok's proposed kind apart from Jev's assessed kind", async () => {
    const disagreeing: FakeJudgments = {
      ...acceptingJudgments,
      async assessClaim() {
        const accepted = await acceptingJudgments.assessClaim(evidence("work", 40));
        return { ...accepted, eventKind: "shipped_product" as const };
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(disagreeing),
    });
    expect(result.claims[0]?.status).toBe("accepted");
    expect(result.claims[0]?.proposedEventKind).toBe("open_source_contribution");
    expect(result.claims[0]?.assessedEventKind).toBe("shipped_product");
    // The event is built from the assessed kind, not the proposed one.
    expect(result.events[0]?.kind).toBe("shipped_product");
  });

  test("an identity-rejected claim carries no assessed kind and keeps Grok's", async () => {
    let assessClaimCalls = 0;
    const different: FakeJudgments = {
      async assessIdentity() {
        return {
          decision: "different",
          confidence: 0.97,
          fieldMatches: { name: 0.1, affiliation: 0.1, handle: 0.05 },
        };
      },
      async assessClaim(item) {
        assessClaimCalls++;
        return acceptingJudgments.assessClaim(item);
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(different),
    });
    expect(assessClaimCalls).toBe(0);
    expect(result.claims[0]?.status).toBe("rejected");
    expect(result.claims[0]?.assessedEventKind).toBe(null);
    expect(result.claims[0]?.proposedEventKind).toBe("open_source_contribution");
    // A rejected claim is not under review, so it carries no reasons.
    expect("reviewReasons" in (result.claims[0] ?? {})).toBe(false);
    expect(result.events).toHaveLength(0);
    expect(result.needsReview).toBe(false);
  });

  test("a same-person decision below the confidence threshold stops before assessment", async () => {
    let assessClaimCalls = 0;
    const unsure: FakeJudgments = {
      async assessIdentity() {
        return {
          decision: "same",
          confidence: 0.6,
          fieldMatches: { name: 0.99, affiliation: 0.8, handle: 1 },
        };
      },
      async assessClaim(item) {
        assessClaimCalls++;
        return acceptingJudgments.assessClaim(item);
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(unsure),
    });
    expect(assessClaimCalls).toBe(0);
    expect(result.claims[0]?.status).toBe("review");
    expect(result.claims[0]?.reviewReasons).toEqual(["identity_low_confidence"]);
    expect(result.claims[0]?.assessedEventKind).toBe(null);
    expect(result.events).toHaveLength(0);
  });

  test("an event with no dimension judgments records why it went to review", async () => {
    // Routing to review is already covered by the incomplete-judgment gate; what
    // this pins is that the empty case is labelled, not silently lumped in with
    // a partial or out-of-range judgment set.
    const unjudged: FakeJudgments = {
      ...acceptingJudgments,
      async assessClaim() {
        const accepted = await acceptingJudgments.assessClaim(evidence("work", 40));
        return { ...accepted, dimensions: [] };
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(unjudged),
    });
    expect(result.claims[0]?.status).toBe("review");
    expect(result.claims[0]?.reviewReasons).toEqual(["no_dimensions"]);
    expect(result.needsReview).toBe(true);
    const outcomes = careerEventsToLongitudinalRecords(result.events).outcomes;
    expect(outcomes).toEqual([]);
  });

  test("claims that are not routed to review carry no reviewReasons field", async () => {
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(acceptingJudgments),
    });
    expect(result.claims[0]?.status).toBe("accepted");
    expect("reviewReasons" in (result.claims[0] ?? {})).toBe(false);
    expect(result.claims[0]?.proposedEventKind).toBe("open_source_contribution");
    expect(result.claims[0]?.assessedEventKind).toBe("open_source_contribution");
  });

  test("missing dimensions route to review and never become a zero outcome", async () => {
    const missingDimensions: FakeJudgments = {
      ...acceptingJudgments,
      async assessClaim() {
        return {
          eventKind: "shipped_product",
          eventConfidence: 0.99,
          dimensions: [],
        };
      },
    };
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(missingDimensions),
    });
    expect(result.claims[0]?.status).toBe("review");
    expect(result.events[0]?.status).toBe("review");
    expect(careerEventsToLongitudinalRecords(result.events).outcomes).toEqual([]);

    const malformedAccepted = { ...event("malformed", "p-1", 40, 2), judgments: [] };
    expect(careerEventsToLongitudinalRecords([malformedAccepted]).outcomes).toEqual([]);
  });
});

describe("claim validation: an absent identity judgment", () => {
  const claimOf = async (): Promise<EvidenceClaim> => {
    const result = await processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(acceptingJudgments),
    });
    return result.claims[0] as EvidenceClaim;
  };

  test("both fields absent together is valid; half-absent is not", async () => {
    const claim = await claimOf();
    expect(validateEvidenceClaim(claim).ok).toBe(true);
    expect(
      validateEvidenceClaim({ ...claim, identityDecision: null, identityConfidence: null }).ok,
    ).toBe(true);
    const halfAbsent = validateEvidenceClaim({ ...claim, identityConfidence: null });
    expect(halfAbsent.ok).toBe(false);
    expect(halfAbsent.ok ? [] : halfAbsent.errors).toEqual([
      "identityDecision and identityConfidence are absent together or not at all",
    ]);
    expect(validateEvidenceClaim({ ...claim, identityDecision: null }).ok).toBe(false);
  });

  test("a present confidence outside the unit interval is still rejected", async () => {
    const claim = await claimOf();
    for (const bad of [-0.1, 1.1, Number.NaN]) {
      const result = validateEvidenceClaim({ ...claim, identityConfidence: bad });
      expect(result.ok).toBe(false);
      expect(result.ok ? [] : result.errors).toEqual(["identityConfidence must be in [0, 1]"]);
    }
  });
});
