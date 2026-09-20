import type { JevJudgmentService } from "./judgments.ts";
import { contentFingerprint } from "./provenance.ts";
import type {
  CanonicalIdentity,
  CareerEvent,
  EvidenceClaim,
  GrokEvidenceItem,
  ProfileSnapshot,
  ProgressDimension,
  ProgressVector,
} from "./types.ts";

const DIMENSIONS: readonly ProgressDimension[] = [
  "difficulty",
  "ownership",
  "external_impact",
  "originality",
  "peer_validation",
];

export interface EvidencePipelinePolicy {
  identityConfidence: number;
  identityContradiction: number;
  eventConfidence: number;
  dimensionConfidence: number;
  questionVersion: string;
  model: string;
}

export const DEFAULT_EVIDENCE_POLICY: EvidencePipelinePolicy = Object.freeze({
  identityConfidence: 0.75,
  identityContradiction: 0.25,
  eventConfidence: 0.65,
  dimensionConfidence: 0.5,
  questionVersion: "career-evidence@1.0.0",
  model: "jev",
});

export interface ProcessEvidenceInput {
  identity: CanonicalIdentity;
  evidence: readonly GrokEvidenceItem[];
  baselineAt?: Date;
  cutoffAt: Date;
  retrievedAt: Date;
  pipelineVersion: string;
  judgments: JevJudgmentService;
  policy?: EvidencePipelinePolicy;
}

export interface ProcessEvidenceResult {
  claims: EvidenceClaim[];
  events: CareerEvent[];
  snapshot: ProfileSnapshot;
  needsReview: boolean;
}

export async function processEvidence(input: ProcessEvidenceInput): Promise<ProcessEvidenceResult> {
  const policy = input.policy ?? DEFAULT_EVIDENCE_POLICY;
  const baselineMs = input.baselineAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const eligible = input.evidence
    .filter((evidence) => {
      const publishedAt = Date.parse(evidence.publishedAt);
      return publishedAt > baselineMs && publishedAt <= input.cutoffAt.getTime();
    })
    .sort(
      (a, b) =>
        Date.parse(a.publishedAt) - Date.parse(b.publishedAt) ||
        a.sourceId.localeCompare(b.sourceId),
    );

  const processed = await Promise.all(
    eligible.map(async (evidence) => {
      const identity = await input.judgments.assessIdentity(input.identity, evidence);
      const claimId = `claim-${contentFingerprint({
        personId: input.identity.personId,
        sourceId: evidence.sourceId,
        publishedAt: evidence.publishedAt,
        contentHash: evidence.contentHash,
      })}`;
      const provenance = {
        source: evidence.source,
        sourceId: evidence.sourceId,
        url: evidence.url,
        publisher: evidence.publisher,
        publishedAt: new Date(evidence.publishedAt),
        retrievedAt: new Date(input.retrievedAt.getTime()),
        quotedText: evidence.quotedText,
        contentHash: evidence.contentHash,
      };

      const contradictoryIdentity =
        identity.decision === "same" &&
        contradictoryFieldMatches(identity.fieldMatches, policy.identityContradiction);
      if (
        identity.decision === "different" ||
        (identity.decision === "same" && identity.confidence < policy.identityConfidence) ||
        contradictoryIdentity
      ) {
        const status = identity.decision === "different" ? "rejected" : "review";
        const claim: EvidenceClaim = {
          id: claimId,
          personId: input.identity.personId,
          provenance,
          statement: evidence.statement,
          proposedEventKind: evidence.proposedEventKind,
          status,
          identityDecision: identity.decision,
          identityConfidence: identity.confidence,
          createdAt: new Date(input.retrievedAt.getTime()),
        };
        return { claim, event: null };
      }

      const assessment = await input.judgments.assessClaim(evidence);
      const lowDimensionConfidence = assessment.dimensions.some(
        (judgment) => judgment.confidence < policy.dimensionConfidence,
      );
      const needsReview =
        identity.decision === "review" ||
        identity.confidence < policy.identityConfidence ||
        assessment.eventConfidence < policy.eventConfidence ||
        lowDimensionConfidence;
      const status =
        assessment.eventKind === null ? "rejected" : needsReview ? "review" : "accepted";
      const claim: EvidenceClaim = {
        id: claimId,
        personId: input.identity.personId,
        provenance,
        statement: evidence.statement,
        proposedEventKind: assessment.eventKind,
        status,
        identityDecision: identity.decision,
        identityConfidence: identity.confidence,
        createdAt: new Date(input.retrievedAt.getTime()),
      };
      if (assessment.eventKind === null) return { claim, event: null };

      const event: CareerEvent = {
        id: `event-${contentFingerprint({ claimId, kind: assessment.eventKind })}`,
        personId: input.identity.personId,
        kind: assessment.eventKind,
        title: evidence.statement,
        description: evidence.quotedText,
        observedAt: new Date(evidence.publishedAt),
        evidenceClaimIds: [claimId],
        judgments: assessment.dimensions,
        status: needsReview ? "review" : "accepted",
        model: policy.model,
        questionVersion: policy.questionVersion,
        createdAt: new Date(input.retrievedAt.getTime()),
      };
      return { claim, event };
    }),
  );

  const claims = processed.map(({ claim }) => claim);
  const events = processed.flatMap(({ event }) => (event === null ? [] : [event]));
  const snapshotHash = contentFingerprint({
    personId: input.identity.personId,
    cutoffAt: input.cutoffAt.toISOString(),
    claims: claims.map((claim) => [claim.id, claim.status]),
    pipelineVersion: input.pipelineVersion,
  });
  return {
    claims,
    events,
    snapshot: {
      id: `profile-${snapshotHash}`,
      personId: input.identity.personId,
      capturedAt: new Date(input.retrievedAt.getTime()),
      cutoffAt: new Date(input.cutoffAt.getTime()),
      claimIds: claims.map((claim) => claim.id),
      contentHash: snapshotHash,
      pipelineVersion: input.pipelineVersion,
    },
    needsReview: claims.some((claim) => claim.status === "review"),
  };
}

function contradictoryFieldMatches(
  fieldMatches: { name: number; affiliation: number; handle: number },
  threshold: number,
): boolean {
  return (
    [fieldMatches.name, fieldMatches.affiliation, fieldMatches.handle].filter(
      (value) => value < threshold,
    ).length >= 2
  );
}

export function progressVector(
  personId: string,
  from: Date,
  to: Date,
  events: readonly CareerEvent[],
): ProgressVector {
  const accepted = events.filter(
    (event) =>
      event.personId === personId &&
      event.status === "accepted" &&
      event.observedAt.getTime() > from.getTime() &&
      event.observedAt.getTime() <= to.getTime(),
  );
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((dimension) => {
      const values = accepted.flatMap((event) =>
        event.judgments
          .filter((judgment) => judgment.dimension === dimension)
          .map((judgment) => judgment.score / 4),
      );
      return [
        dimension,
        values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
      ];
    }),
  ) as Record<ProgressDimension, number | null>;
  return {
    personId,
    from: new Date(from.getTime()),
    to: new Date(to.getTime()),
    dimensions,
    acceptedEventIds: accepted.map((event) => event.id).sort(),
  };
}
