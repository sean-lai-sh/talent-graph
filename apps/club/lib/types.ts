import type { ReviewBucket } from "../../../src/analysis/reviewQueue.ts";
import type {
  ComparisonOutcome,
  Dimension,
  EvidenceType,
  PersonStatus,
  RubricScore,
  Scale5,
} from "../../../src/domain/types.ts";
import type { TrackRecordLabel } from "../../../src/judges/trackRecord.ts";

/** ISO-8601 timestamps — ClubState crosses the server/client boundary. */
export type IsoDate = string;

/**
 * Council workflow state. Lives in the app layer only; the engine reads
 * `status` (candidate | member | archived) and never this field.
 * admitted ⇔ member, denied ⇔ archived, everything else ⇔ candidate.
 */
export type ReviewStatus = "new" | "under_review" | "needs_data" | "admitted" | "denied";

export type Decision = "start_review" | "admit" | "deny" | "request_data" | "reopen";

export interface ClubPerson {
  id: string;
  name: string;
  bio?: string;
  affiliation?: string;
  /** Display metadata (spec page 1/2). No function in src/ reads these. */
  phone?: string;
  linkedin?: string;
  status: PersonStatus;
  /** Optional so documents written before the council page stay valid. */
  reviewStatus?: ReviewStatus;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface ClubReferral {
  id: string;
  referrerId: string;
  candidateId: string;
  conviction: Scale5;
  confidence: Scale5;
  relationshipDepth: Scale5;
  evidenceType: EvidenceType;
  evidenceText: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface ClubComparison {
  id: string;
  evaluatorId: string;
  personAId: string;
  personBId: string;
  dimension: Dimension;
  outcome: ComparisonOutcome;
  winnerId: string | null;
  confidence: Scale5 | null;
  evidenceText?: string;
  createdAt: IsoDate;
}

export interface ClubEvaluation {
  id: string;
  evaluatorId: string;
  candidateId: string;
  dimension: Dimension;
  score: RubricScore | null;
  confidence: Scale5 | null;
  evidenceText: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface ClubOutcome {
  id: string;
  personId: string;
  opportunityId: string | null;
  kind: string;
  value: number | null;
  observedAt: IsoDate;
  createdAt: IsoDate;
}

export interface ClubOpportunity {
  id: string;
  personId: string;
  kind: string;
  description: string;
  startedAt: IsoDate;
  endedAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface ClubSnapshot {
  id: string;
  personId: string;
  personName: string;
  decision: string;
  /** Provenance at decision time — not a score threshold. */
  values: {
    referralSignal: number | null;
    incomingCount: number;
  };
  createdAt: IsoDate;
}

/**
 * A council request for a member's feedback on a candidate. Fulfilled by a
 * rubric Evaluation from that member recorded after `requestedAt`.
 */
export interface ClubFeedbackRequest {
  id: string;
  candidateId: string;
  memberId: string;
  requestedAt: IsoDate;
  /** requestedAt + FEEDBACK_WINDOW_HOURS. */
  dueAt: IsoDate;
  note: string;
  respondedAt: IsoDate | null;
  evaluationId: string | null;
}

/** Per-org council settings. Which evidence a round requires; never a weight. */
export interface ReviewConfig {
  requiredDimensions: Dimension[];
}

export interface ClubState {
  people: ClubPerson[];
  referrals: ClubReferral[];
  comparisons: ClubComparison[];
  evaluations: ClubEvaluation[];
  outcomes: ClubOutcome[];
  opportunities: ClubOpportunity[];
  snapshots: ClubSnapshot[];
  feedbackRequests: ClubFeedbackRequest[];
  config: ReviewConfig;
  /** Evaluation time T for judge calibration and feedback windows. */
  now: IsoDate;
}

/* ------------------------------------------------------------------ *
 * View model
 * ------------------------------------------------------------------ */

/** Categorical only. The raw calibration numbers never enter the view. */
export interface TrackRecordView {
  label: TrackRecordLabel;
  evaluatedCount: number;
}

export interface CandidateRow {
  personId: string;
  name: string;
  affiliation: string;
  status: PersonStatus;
  reviewStatus: ReviewStatus;
  bucket: ReviewBucket | null;
  flags: ReviewBucket[];
  /** Null when incomingCount === 0 — missing evidence is not a score of 0. */
  v2Signal: number | null;
  incomingCount: number;
  firsthandCount: number;
  evaluationCount: number;
  comparisonCount: number;
  estimated: Partial<Record<Dimension, { percentile: number; poolConfidence: PoolConfidence }>>;
  pendingFeedback: number;
  overdueFeedback: number;
  daysInReview: number;
  createdAt: IsoDate;
  persona: boolean;
}

export type PoolConfidence = "low" | "medium" | "high";

export interface DimensionView {
  dimension: Dimension;
  label: string;
  prompt: string;
  required: boolean;
  state: "estimated" | "insufficient_evidence";
  percentile: number | null;
  comparisonCount: number;
  opponentCount: number;
  poolSize: number | null;
  poolConfidence: PoolConfidence | null;
  reason: string | null;
}

export interface RubricSummaryRow {
  dimension: Dimension;
  label: string;
  required: boolean;
  mean: number | null;
  /** Rubric anchor for the rounded mean, or null. */
  anchor: string | null;
  scored: number;
  notObserved: number;
  evaluators: number;
}

export interface MissingEvidenceItem {
  kind: "rubric_missing" | "capability_insufficient" | "single_source" | "no_referrals";
  dimension?: Dimension;
  dimensionLabel?: string;
  text: string;
}

export interface SuggestedMember {
  personId: string;
  name: string;
  trackRecord: TrackRecordView;
  because: string;
}

export type FeedbackState = "pending" | "overdue" | "responded";

export interface FeedbackView {
  id: string;
  candidateId: string;
  memberId: string;
  memberName: string;
  trackRecord: TrackRecordView;
  requestedAt: IsoDate;
  dueAt: IsoDate;
  note: string;
  /** Computed against `ClubView.now`; components may recompute with their own clock. */
  state: FeedbackState;
  respondedAt: IsoDate | null;
  evaluationId: string | null;
}

export interface ContributingView {
  referralId: string;
  referrerId: string;
  referrerName: string;
  judgeTrackRecord: TrackRecordView;
  strength: number;
  conviction: Scale5;
  confidence: Scale5;
  relationshipDepth: Scale5;
  evidenceType: EvidenceType;
  evidenceText: string;
  multiplier: number;
  createdAt: IsoDate;
}

export interface ReferralView extends ContributingView {
  /** False when the referral exists but did not enter Top-K. */
  contributing: boolean;
}

export type ComparisonResult = "won" | "lost" | "tie" | "skip" | "not_observed";

export type EvidenceItem =
  | {
      kind: "referral";
      id: string;
      createdAt: IsoDate;
      evidenceText: string;
      evidenceType: EvidenceType;
      conviction: Scale5;
      confidence: Scale5;
      relationshipDepth: Scale5;
      strength: number;
      contributing: boolean;
    }
  | {
      kind: "evaluation";
      id: string;
      createdAt: IsoDate;
      evidenceText: string;
      dimension: Dimension;
      dimensionLabel: string;
      score: RubricScore | null;
      scoreLabel: string;
      confidence: Scale5 | null;
    }
  | {
      kind: "comparison";
      id: string;
      createdAt: IsoDate;
      evidenceText: string | null;
      dimension: Dimension;
      dimensionLabel: string;
      outcome: ComparisonOutcome;
      result: ComparisonResult;
      otherId: string;
      otherName: string;
      confidence: Scale5 | null;
    };

export interface JudgeEvidenceGroup {
  judgeId: string;
  name: string;
  status: PersonStatus | null;
  trackRecord: TrackRecordView;
  items: EvidenceItem[];
}

export interface EvaluationView {
  id: string;
  evaluatorId: string;
  evaluatorName: string;
  trackRecord: TrackRecordView;
  dimension: Dimension;
  dimensionLabel: string;
  score: RubricScore | null;
  scoreLabel: string;
  confidence: Scale5 | null;
  evidenceText: string;
  createdAt: IsoDate;
}

export interface ComparisonHistoryRow {
  id: string;
  dimension: Dimension;
  dimensionLabel: string;
  otherId: string;
  otherName: string;
  evaluatorId: string;
  evaluatorName: string;
  outcome: ComparisonOutcome;
  result: ComparisonResult;
  confidence: Scale5 | null;
  evidenceText: string | null;
  createdAt: IsoDate;
}

export interface NeighbourRef {
  personId: string;
  name: string;
  status: PersonStatus;
  referralId: string;
  strength: number;
}

export interface GapRow {
  personId: string;
  name: string;
  dimension: Dimension;
  dimensionLabel: string;
  gap: number;
  capabilityPercentile: number;
  referralPercentile: number;
  tag: "exploratory";
}

export interface PersonView {
  id: string;
  name: string;
  bio: string;
  affiliation: string;
  phone: string | null;
  linkedin: string | null;
  status: PersonStatus;
  reviewStatus: ReviewStatus;
  persona: boolean;
  createdAt: IsoDate;
  daysInReview: number;
  /** Null when incomingCount === 0 — missing evidence is not a score of 0. */
  v0Signal: number | null;
  v2Signal: number | null;
  incomingCount: number;
  firsthandCount: number;
  strongest: number | null;
  contributing: ContributingView[];
  referrals: ReferralView[];
  dimensions: DimensionView[];
  rubric: RubricSummaryRow[];
  gaps: GapRow[];
  queue: { bucket: ReviewBucket; flags: ReviewBucket[]; reasons: string[] } | null;
  missingEvidence: MissingEvidenceItem[];
  suggestedMembers: SuggestedMember[];
  feedback: FeedbackView[];
  judgeEvidence: JudgeEvidenceGroup[];
  evaluations: EvaluationView[];
  comparisonHistory: ComparisonHistoryRow[];
  neighbourhood: { referrers: NeighbourRef[]; referred: NeighbourRef[] };
}

export interface MemberOption {
  id: string;
  name: string;
  status: PersonStatus;
  trackRecord: TrackRecordView;
}

export interface ClubView {
  counts: {
    people: number;
    underConsideration: number;
    needsData: number;
    admitted: number;
    denied: number;
    referrals: number;
    comparisons: number;
    evaluations: number;
    pendingFeedback: number;
    overdueFeedback: number;
  };
  now: IsoDate;
  calibration: {
    observationWindowDays: number;
    windowOpen: boolean;
    evaluatedReferrals: number;
    judgesWithEvidence: number;
  };
  config: ReviewConfig;
  /** People a council can ask for feedback: members plus anyone with evidence. */
  members: MemberOption[];
  candidates: CandidateRow[];
  people: PersonView[];
  snapshots: ClubSnapshot[];
}

export interface EngineResult {
  state: ClubState;
  view: ClubView;
  error?: string;
}

/* ------------------------------------------------------------------ *
 * Mutation inputs (shared by server actions and Convex)
 * ------------------------------------------------------------------ */

export interface AddPersonInput {
  name: string;
  bio?: string;
  affiliation?: string;
  phone?: string;
  linkedin?: string;
  status?: PersonStatus;
}

export interface AddReferralInput {
  referrerId: string;
  candidateId: string;
  conviction: Scale5;
  confidence: Scale5;
  relationshipDepth: Scale5;
  evidenceType: EvidenceType;
  evidenceText: string;
}

export interface AddComparisonInput {
  personAId: string;
  personBId: string;
  dimension: Dimension;
  outcome: ComparisonOutcome;
  confidence?: Scale5 | null;
  evidenceText?: string;
  evaluatorId?: string;
}

export interface AddEvaluationInput {
  evaluatorId: string;
  candidateId: string;
  dimension: Dimension;
  score: RubricScore | null;
  confidence: Scale5 | null;
  evidenceText: string;
}

export interface RequestFeedbackInput {
  candidateId: string;
  memberIds: string[];
  note: string;
}

export interface RecordFeedbackInput extends AddEvaluationInput {
  requestId?: string;
}

export interface SetReviewConfigInput {
  requiredDimensions: Dimension[];
}

/** Persistence overrides for ClubBoard. Example uses server actions. */
export interface ClubBoardActions {
  decide: (state: ClubState, personId: string, decision: Decision) => Promise<EngineResult>;
  requestFeedback: (state: ClubState, input: RequestFeedbackInput) => Promise<EngineResult>;
  recordFeedback: (state: ClubState, input: RecordFeedbackInput) => Promise<EngineResult>;
  setReviewConfig: (state: ClubState, input: SetReviewConfigInput) => Promise<EngineResult>;
  addPerson?: (state: ClubState, input: AddPersonInput) => Promise<EngineResult>;
  reset?: () => Promise<EngineResult>;
}
