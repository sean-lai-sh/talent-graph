import type { JevJudgmentRecord } from "./records.ts";
import type {
  CanonicalIdentity,
  CareerEventKind,
  DimensionJudgment,
  GrokEvidenceItem,
  IdentityDecision,
} from "./types.ts";

export interface IdentityAssessment {
  decision: IdentityDecision;
  confidence: number;
  fieldMatches: {
    name: number;
    affiliation: number;
    handle: number;
  };
}

export interface ClaimAssessment {
  eventKind: CareerEventKind | null;
  eventConfidence: number;
  dimensions: DimensionJudgment[];
}

/**
 * One judgment: the raw observation and the assessment projected from it.
 *
 * The record is what was observed — the model that answered, its usage, the
 * request id, the un-rounded scores and the full probability vectors — and the
 * assessment is `projectIdentity`/`projectClaim` of that record. Returning
 * both keeps the derivation reproducible without a second paid call, and an
 * implementation that returns an assessment its record does not project to is
 * lying about what it observed.
 */
export interface JevJudgment<TAssessment> {
  assessment: TAssessment;
  record: JevJudgmentRecord;
}

/**
 * What a caller may attach to one judgment request.
 *
 * Cancellation only. Transport policy — how long an attempt may take, how
 * often it is retried — is set once where the client is constructed, in the
 * app layer; the pipeline knows nothing about either, and passes on only the
 * `AbortSignal` its caller gave it.
 */
export interface JevRequestOptions {
  signal?: AbortSignal;
}

/** Pure pipeline port; the TypeSafe SDK implementation lives in the app layer. */
export interface JevJudgmentService {
  /**
   * The cache key of the identity request this service would send, computed
   * without sending it. The request is the service's own business, so only the
   * service can name it; the pipeline uses this to consult the judgment store
   * before the network.
   */
  identityFingerprint(identity: CanonicalIdentity, evidence: GrokEvidenceItem): string;
  /** The cache key of the claim request this service would send. */
  claimFingerprint(evidence: GrokEvidenceItem): string;
  assessIdentity(
    identity: CanonicalIdentity,
    evidence: GrokEvidenceItem,
    options?: JevRequestOptions,
  ): Promise<JevJudgment<IdentityAssessment>>;
  /**
   * `personId` is not shown to the model — the claim request carries the
   * evidence alone — but the record it produces is an observation *about* a
   * person's evidence, so the person is what its `evidenceKey` is built from.
   */
  assessClaim(
    evidence: GrokEvidenceItem,
    personId: string,
    options?: JevRequestOptions,
  ): Promise<JevJudgment<ClaimAssessment>>;
}
