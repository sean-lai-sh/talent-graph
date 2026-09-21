/**
 * The pure stages of the evidence pipeline.
 *
 * `processEvidence` is the orchestration around these: it decides what to fan
 * out and calls the judgment service, the only impure step. Everything that
 * decides an outcome — which evidence is eligible, whether identity is settled,
 * what status a claim carries and what records are written — is a function of
 * its arguments alone, so it can be tabulated in a test without a fake service.
 */

import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "./dimensions.ts";
import type { ClaimAssessment, IdentityAssessment } from "./judgments.ts";
import { contentFingerprint } from "./provenance.ts";
import type {
  CareerEvent,
  ClaimStatus,
  DimensionJudgment,
  EvidenceClaim,
  GrokEvidenceItem,
  ReviewReason,
} from "./types.ts";

/**
 * The decision thresholds the stages read. Kept apart from the stamping fields
 * (`model`, `questionVersion`) so a stage that decides never reads one.
 */
export interface EvidenceThresholds {
  identityConfidence: number;
  identityContradiction: number;
  eventConfidence: number;
  dimensionConfidence: number;
}

/** What the stages stamp onto materialized events, alongside the thresholds. */
export interface EvidenceStamp {
  model: string;
  questionVersion: string;
}

/**
 * Evidence inside the window, oldest first, ties broken by `sourceId`.
 *
 * `baselineAt` is exclusive and `cutoffAt` inclusive, as the checkpoint windows
 * are: an item published exactly at a previous baseline was already seen.
 */
export function selectEligible(
  evidence: readonly GrokEvidenceItem[],
  baselineAt: Date | undefined,
  cutoffAt: Date,
): GrokEvidenceItem[] {
  const baselineMs = baselineAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const cutoffMs = cutoffAt.getTime();
  return evidence
    .filter((item) => {
      const publishedAt = Date.parse(item.publishedAt);
      return publishedAt > baselineMs && publishedAt <= cutoffMs;
    })
    .sort(
      (a, b) =>
        Date.parse(a.publishedAt) - Date.parse(b.publishedAt) ||
        a.sourceId.localeCompare(b.sourceId),
    );
}

export type IdentityGate =
  | { kind: "pass" }
  | { kind: "stop"; status: "rejected" | "review"; reasons: ReviewReason[] };

/**
 * Settle identity before any claim assessment is paid for.
 *
 * `contradictoryFieldMatches` stays scoped to `same`: a `review` decision
 * already stops, so consulting the field matches could not change the outcome,
 * only the reason we record.
 */
export function gateIdentity(
  identity: IdentityAssessment,
  thresholds: EvidenceThresholds,
): IdentityGate {
  if (identity.decision === "different") {
    return { kind: "stop", status: "rejected", reasons: [] };
  }
  const reasons: ReviewReason[] = [];
  if (identity.decision === "review") {
    reasons.push("identity_ambiguous");
  }
  if (identity.decision === "same" && identity.confidence < thresholds.identityConfidence) {
    reasons.push("identity_low_confidence");
  }
  if (
    identity.decision === "same" &&
    contradictoryFieldMatches(identity.fieldMatches, thresholds.identityContradiction)
  ) {
    reasons.push("identity_contradictory_fields");
  }
  if (reasons.length > 0) return { kind: "stop", status: "review", reasons };
  return { kind: "pass" };
}

/**
 * The status a claim carries, with the reasons that forced review.
 *
 * `assessment` is `null` when no claim assessment ran: either the identity gate
 * stopped the item, or judging was unavailable. The first case keeps the gate's
 * own status and reasons; the second is a review we cannot explain by evidence.
 *
 * `identity` is `null` when even the identity judgment was unavailable — a
 * failure the fan-out isolated. There is then nothing to gate on, so the item
 * is a review for the same reason, and an assessment without one is not
 * representable: a claim cannot have been judged for a person nothing linked
 * it to.
 */
export function decideStatus(
  identity: IdentityAssessment | null,
  assessment: ClaimAssessment | null,
  thresholds: EvidenceThresholds,
): { status: ClaimStatus; reasons: ReviewReason[] } {
  if (identity === null) {
    if (assessment !== null) {
      throw new TypeError(
        "decideStatus: a claim assessment without an identity judgment is not representable",
      );
    }
    return { status: "review", reasons: ["judgment_unavailable"] };
  }
  const gate = gateIdentity(identity, thresholds);
  if (assessment === null) {
    if (gate.kind === "stop") return { status: gate.status, reasons: gate.reasons };
    return { status: "review", reasons: ["judgment_unavailable"] };
  }
  if (gate.kind === "stop") return { status: gate.status, reasons: gate.reasons };

  const lowEventConfidence = assessment.eventConfidence < thresholds.eventConfidence;
  // No judgments is not agreement: `.some()` is false for an empty array, so
  // the completeness check below is what routes an unjudged event to review.
  const noDimensions = assessment.dimensions.length === 0;
  const lowDimensionConfidence = assessment.dimensions.some(
    (judgment) => judgment.confidence < thresholds.dimensionConfidence,
  );
  const needsReview =
    lowEventConfidence ||
    !hasCompleteDimensionJudgments(assessment.dimensions) ||
    lowDimensionConfidence;
  const status: ClaimStatus =
    assessment.eventKind === null ? "rejected" : needsReview ? "review" : "accepted";
  if (status !== "review") return { status, reasons: [] };
  // Only reasons that are literally true of this assessment. A judgment set
  // that is malformed in some other way (partial, or out of range) still routes
  // to review and carries no reason rather than a plausible-looking one.
  const reasons: ReviewReason[] = [];
  if (lowEventConfidence) reasons.push("event_low_confidence");
  if (noDimensions) reasons.push("no_dimensions");
  if (lowDimensionConfidence) reasons.push("dimension_low_confidence");
  return { status, reasons };
}

export interface MaterializeInput {
  personId: string;
  evidence: GrokEvidenceItem;
  retrievedAt: Date;
  /** `null` when the identity judgment itself was unavailable. */
  identity: IdentityAssessment | null;
  /** `null` when no claim assessment ran; the claim then carries no kind. */
  assessment: ClaimAssessment | null;
  decision: { status: ClaimStatus; reasons: ReviewReason[] };
  stamp: EvidenceStamp;
}

/** The records one evidence item produces, given a settled decision. */
export function materialize(input: MaterializeInput): {
  claim: EvidenceClaim;
  event: CareerEvent | null;
} {
  const claimId = `claim-${contentFingerprint({
    personId: input.personId,
    sourceId: input.evidence.sourceId,
    publishedAt: input.evidence.publishedAt,
    contentHash: input.evidence.contentHash,
  })}`;
  const claim: EvidenceClaim = {
    id: claimId,
    personId: input.personId,
    provenance: {
      source: input.evidence.source,
      sourceId: input.evidence.sourceId,
      url: input.evidence.url,
      publisher: input.evidence.publisher,
      publishedAt: new Date(input.evidence.publishedAt),
      retrievedAt: new Date(input.retrievedAt.getTime()),
      quotedText: input.evidence.quotedText,
      contentHash: input.evidence.contentHash,
    },
    statement: input.evidence.statement,
    proposedEventKind: input.evidence.proposedEventKind,
    assessedEventKind: input.assessment?.eventKind ?? null,
    status: input.decision.status,
    // `null`, not a low number: an identity judgment that was never made is a
    // recorded absence, and a `0` here would read as "certainly someone else".
    identityDecision: input.identity?.decision ?? null,
    identityConfidence: input.identity?.confidence ?? null,
    // Absent, not empty: a claim with nothing to say carries no vacuous field.
    ...(input.decision.reasons.length > 0 ? { reviewReasons: [...input.decision.reasons] } : {}),
    createdAt: new Date(input.retrievedAt.getTime()),
  };
  const eventKind = input.assessment?.eventKind ?? null;
  if (input.assessment !== null && input.identity === null) {
    throw new TypeError(
      "materialize: a claim assessment without an identity judgment is not representable",
    );
  }
  if (input.assessment === null || eventKind === null) return { claim, event: null };
  if (input.decision.status !== "accepted" && input.decision.status !== "review") {
    // An assessed event kind with a rejected or proposed status has no event:
    // the caller passed a decision that does not belong to this assessment.
    throw new TypeError(
      `materialize: assessed event kind with status "${input.decision.status}" is not representable`,
    );
  }
  const event: CareerEvent = {
    id: `event-${contentFingerprint({ claimId, kind: eventKind })}`,
    personId: input.personId,
    kind: eventKind,
    title: input.evidence.statement,
    description: input.evidence.quotedText,
    observedAt: new Date(input.evidence.publishedAt),
    evidenceClaimIds: [claimId],
    judgments: input.assessment.dimensions,
    status: input.decision.status,
    model: input.stamp.model,
    questionVersion: input.stamp.questionVersion,
    createdAt: new Date(input.retrievedAt.getTime()),
  };
  return { claim, event };
}

function contradictoryFieldMatches(
  fieldMatches: { name: number; affiliation: number; handle: number },
  threshold: number,
): boolean {
  return [fieldMatches.name, fieldMatches.affiliation, fieldMatches.handle].some(
    (value) => !Number.isFinite(value) || value < threshold,
  );
}

/** Exactly one in-range judgment per dimension; anything else is not complete. */
export function hasCompleteDimensionJudgments(judgments: readonly DimensionJudgment[]): boolean {
  if (judgments.length !== CAREER_EVIDENCE_DIMENSIONS.length) return false;
  return CAREER_EVIDENCE_DIMENSIONS.every(
    (dimension) =>
      judgments.filter((judgment) => judgment.dimension === dimension).length === 1 &&
      judgments.some(
        (judgment) =>
          judgment.dimension === dimension &&
          Number.isFinite(judgment.score) &&
          judgment.score >= 0 &&
          judgment.score <= MAX_LEVEL &&
          Number.isFinite(judgment.confidence) &&
          judgment.confidence >= 0 &&
          judgment.confidence <= 1,
      ),
  );
}
