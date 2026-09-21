/**
 * App-facing contracts for longitudinal public evidence.
 *
 * These records deliberately stay outside scoring and inference. They preserve
 * what was observed, when it was knowable, and how a semantic judgment was
 * made before accepted events are translated into Outcome/Opportunity rows.
 */

export const SOURCE_KINDS = [
  "github",
  "personal_site",
  "resume",
  "orcid",
  "openalex",
  "package_registry",
  "company_site",
  "x",
  "grok_web",
  "other",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export type ClaimStatus = "proposed" | "accepted" | "review" | "rejected";
export type MonitoringStatus = "pending" | "running" | "completed" | "review" | "failed";
export type IdentityDecision = "same" | "review" | "different";

/**
 * Why a claim was routed to review. Kept as a union so later stages can add
 * their own reasons without changing the field's shape.
 */
export type ReviewReason = "no_dimensions";

export const CAREER_EVENT_KINDS = [
  "selective_role_transition",
  "shipped_product",
  "open_source_contribution",
  "research_output",
  "venture_traction",
  "grant_or_award",
  "community_or_craft_contribution",
] as const;

export type CareerEventKind = (typeof CAREER_EVENT_KINDS)[number];

export type ProgressDimension =
  | "difficulty"
  | "ownership"
  | "external_impact"
  | "originality"
  | "peer_validation";

export interface ExternalIdentity {
  source: SourceKind;
  externalId: string;
  url: string;
  verifiedAt: Date | null;
}

export interface CanonicalIdentity {
  personId: string;
  name: string;
  aliases: string[];
  externalIdentities: ExternalIdentity[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SourceProvenance {
  source: SourceKind;
  sourceId: string;
  url: string;
  publisher: string;
  publishedAt: Date;
  retrievedAt: Date;
  quotedText: string;
  contentHash: string;
}

export interface EvidenceClaim {
  id: string;
  personId: string;
  provenance: SourceProvenance;
  statement: string;
  proposedEventKind: CareerEventKind | null;
  status: ClaimStatus;
  identityDecision: IdentityDecision;
  identityConfidence: number;
  /**
   * Present only when a specific, machine-checkable reason forced review.
   * Absent (not empty) otherwise, so claims carry no vacuous field.
   */
  reviewReasons?: ReviewReason[];
  createdAt: Date;
}

export interface ProfileSnapshot {
  id: string;
  personId: string;
  capturedAt: Date;
  /** Evidence later than this instant is excluded even when collection ran late. */
  cutoffAt: Date;
  claimIds: string[];
  contentHash: string;
  pipelineVersion: string;
}

export interface DimensionJudgment {
  dimension: ProgressDimension;
  /** Semantic level in [0, MAX_LEVEL] (see ./dimensions.ts). */
  score: number;
  probabilities: number[];
  confidence: number;
}

export interface CareerEvent {
  id: string;
  personId: string;
  kind: CareerEventKind;
  title: string;
  description: string;
  observedAt: Date;
  evidenceClaimIds: string[];
  judgments: DimensionJudgment[];
  status: Exclude<ClaimStatus, "proposed">;
  model: string;
  questionVersion: string;
  createdAt: Date;
}

export interface MonitoringPlan {
  id: string;
  personId: string;
  caseId: string;
  baselineAt: Date;
  horizonDays: 90 | 180;
  dueAt: Date;
  pipelineVersion: string;
  status: MonitoringStatus;
  attemptCount: number;
  lastAttemptAt: Date | null;
  completedAt: Date | null;
  baselineSnapshotId: string | null;
  resultSnapshotId: string | null;
  error: string | null;
}

export interface GrokEvidenceItem {
  source: SourceKind;
  sourceId: string;
  url: string;
  publisher: string;
  publishedAt: string;
  quotedText: string;
  contentHash: string;
  statement: string;
  proposedEventKind: CareerEventKind | null;
}

export interface GrokEvidencePacket {
  schemaVersion: "1";
  personId: string;
  runId: string;
  retrievedAt: string;
  cutoffAt: string;
  items: GrokEvidenceItem[];
}

export interface ProgressVector {
  personId: string;
  from: Date;
  to: Date;
  dimensions: Record<ProgressDimension, number | null>;
  acceptedEventIds: string[];
}

export type ResidualSlopeState =
  | "defined"
  | "insufficient_early"
  | "insufficient_late"
  | "undefined_window";

export interface LongitudinalResidualSlope {
  personId: string;
  t0: Date;
  t1: Date;
  residualT0: number | null;
  residualT1: number | null;
  delta: number | null;
  state: ResidualSlopeState;
}
