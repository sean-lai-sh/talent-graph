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

/**
 * How a candidate entered the process. Inbound: a member referred them.
 * Outbound: the recruiting committee selected them. Absent reads as inbound.
 */
export type ClubChannel = "inbound" | "outbound";

/** Where a referral row came from. Absent reads as `"referral"`. */
export type ReferralOrigin = "referral" | "interview";

/** "Has this person received the recognition they deserve?" Stored only; no weight reads it. */
export const REFERRAL_RECOGNITIONS = ["not_yet", "soon", "yes", "not_sure"] as const;
export type ReferralRecognition = (typeof REFERRAL_RECOGNITIONS)[number];

export interface ClubPerson {
  id: string;
  name: string;
  bio?: string;
  affiliation?: string;
  /** Display metadata (spec page 1/2). No function in src/ reads these. */
  phone?: string;
  email?: string;
  linkedin?: string;
  resume?: string;
  resumeStorageId?: string;
  x?: string;
  github?: string;
  website?: string;
  status: PersonStatus;
  /** Optional so documents written before the pipeline model stay valid. */
  channel?: ClubChannel;
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
  /** `"interview"` for the referral a pre-council call's yes creates. */
  origin?: ReferralOrigin;
  /** The referrer's answer to the recognition question. Never read by a weight. */
  recognition?: ReferralRecognition;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export type CallOutcome = "yes" | "maybe" | "no";

/**
 * A pre-council call: up to 2 per candidate. A yes also creates an engine
 * referral by the caller (origin "interview"); a maybe takes no position; a
 * hard no is stored and never scored.
 */
export interface ClubCall {
  id: string;
  candidateId: string;
  callerId: string;
  order: 1 | 2;
  outcome: CallOutcome;
  createdAt: IsoDate;
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
  weight?: number;
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

/**
 * The spec version each kind of the pass ran under, one entry per kind
 * `advance()` runs, so a stored decision names the exact specs it was taken
 * on rather than whatever is current.
 *
 * Each value is a `ModelRun.specVersion` and carries that field's contract: a
 * registered version, which `getSpec(kind, version)` resolves — or one
 * tagged `+env`, which it does not, because a `TG_*` override moved a number
 * away from every registered spec. The tag is the point: a run may not claim
 * a registered version while carrying different numbers, and neither may a
 * decision taken on it.
 */
export interface ClubSpecVersions {
  referral_signal: string;
  bradley_terry: string;
  judge_reliability: string;
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
  /**
   * Ids of every `ModelRun` of the pass the council decided on, in evaluation
   * order. Optional because snapshots written before the Club recorded run
   * ids have none — and absence stays absence: a snapshot without provenance
   * carries no key, never an empty array.
   */
  modelRunIds?: string[];
  /** Spec version per kind of that same pass. Optional for the same reason. */
  specVersions?: ClubSpecVersions;
  /** Person id of the admin who recorded the decision, when they have a person row. */
  decidedBy?: string;
  /**
   * The council-facing Referral Signal without each referrer, at decision time,
   * on the scale of `values.referralSignal`. Absent on older snapshots.
   */
  signalWithout?: ClubSignalWithout[];
}

export interface ClubSignalWithout {
  referrerId: string;
  signalWithout: number;
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
  calls: ClubCall[];
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

export interface TrackRecordView {
  label: TrackRecordLabel;
  evaluatedCount: number;
  /**
   * How much to trust this judge's opinion, in [0, 1]. Null when they have
   * no scored predictions yet — that is not a trust of 0.
   */
  trust: number | null;
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
  estimated: Partial<
    Record<Dimension, { percentile: number; poolSize: number; poolConfidence: PoolConfidence }>
  >;
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
  otherStatus: PersonStatus;
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

export interface NetworkHint {
  lean: "invite" | "look" | "hold";
  text: string;
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
  resume: string | null;
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
  /** Categorical lean from the referral graph. Not a score. */
  networkHint: NetworkHint | null;
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
  resume?: string;
  status?: PersonStatus;
  channel?: ClubChannel;
}

export interface AddReferralInput {
  referrerId: string;
  candidateId: string;
  conviction: Scale5;
  confidence: Scale5;
  relationshipDepth: Scale5;
  evidenceType: EvidenceType;
  evidenceText: string;
  origin?: ReferralOrigin;
  recognition?: ReferralRecognition;
}

/** A call's outcome; a yes carries the ratings of the referral it creates. */
export interface AddCallInput {
  candidateId: string;
  callerId: string;
  order: 1 | 2;
  outcome: CallOutcome;
  /** Required when `outcome` is "yes". */
  referral?: Pick<
    AddReferralInput,
    "conviction" | "confidence" | "relationshipDepth" | "evidenceType" | "evidenceText"
  >;
}

export interface AddComparisonInput {
  personAId: string;
  personBId: string;
  dimension: Dimension;
  outcome: ComparisonOutcome;
  confidence?: Scale5 | null;
  evidenceText?: string;
  evaluatorId?: string;
  /** Share of one judgment, in (0, 1]. Omitted means the stored row has no weight. */
  weight?: number;
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

/**
 * Q1–Q3 answers from a member referral. The chips are the questionnaire's
 * words. `referralAnswersToEngine` is the only place they become engine fields.
 */
export const REFERRAL_Q1_CONTEXTS = [
  "Built something together with a deadline",
  "Same team at work, internship, or research",
  "Class project",
  "Same club or org, different projects",
  "Friends, haven't worked together",
  "Know their work online",
  "Heard about them from others",
] as const;

export type ReferralQ1Context = (typeof REFERRAL_Q1_CONTEXTS)[number];

export const REFERRAL_Q1_LENGTHS = [
  "under 3 months",
  "3 to 12 months",
  "1 to 2 years",
  "2+ years",
] as const;

export type ReferralQ1Length = (typeof REFERRAL_Q1_LENGTHS)[number];

export const REFERRAL_Q1_STAKES = [
  "Grade",
  "Money",
  "Real users",
  "A ship date or competition",
  "No",
] as const;

export type ReferralQ1Stake = (typeof REFERRAL_Q1_STAKES)[number];

export const REFERRAL_Q2_ROLES = [
  "Led it or started it",
  "Major contributor",
  "Kept it running",
  "One of several",
  "I only heard about it",
] as const;

export type ReferralQ2Role = (typeof REFERRAL_Q2_ROLES)[number];

export const REFERRAL_Q3_RANKS = [
  "The best of them",
  "Top 5%",
  "Top 20%",
  "Top half",
  "Hard to say",
] as const;

export type ReferralQ3Rank = (typeof REFERRAL_Q3_RANKS)[number];

export const REFERRAL_Q3_GROUP_SIZES = ["under 10", "10 to 30", "30 to 100", "100+"] as const;

export type ReferralQ3GroupSize = (typeof REFERRAL_Q3_GROUP_SIZES)[number];

export interface MemberReferralAnswers {
  context: ReferralQ1Context;
  length: ReferralQ1Length;
  stakes: readonly ReferralQ1Stake[];
  what: string;
  hard: string;
  distinct: string;
  role: ReferralQ2Role;
  rank: ReferralQ3Rank;
  groupSize: ReferralQ3GroupSize;
  /** Optional; read as "not_sure". Stored only: no weight reads it. */
  recognition?: ReferralRecognition;
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
