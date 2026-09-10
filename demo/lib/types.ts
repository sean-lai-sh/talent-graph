import type {
  ComparisonOutcome,
  Dimension,
  EvidenceType,
  PersonStatus,
  Scale5,
} from "../../src/domain/types.ts";

/** ISO-8601 timestamps — ClubState crosses the server/client boundary. */
export type IsoDate = string;

export interface ClubPerson {
  id: string;
  name: string;
  bio?: string;
  affiliation?: string;
  status: PersonStatus;
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
  score: 0 | 1 | 2 | 3 | 4 | null;
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
  decision: string;
  values: Record<string, number | null>;
  createdAt: IsoDate;
}

export interface ClubState {
  people: ClubPerson[];
  referrals: ClubReferral[];
  comparisons: ClubComparison[];
  evaluations: ClubEvaluation[];
  outcomes: ClubOutcome[];
  opportunities: ClubOpportunity[];
  snapshots: ClubSnapshot[];
  /** Evaluation time step T for V2 judge calibration. */
  now: IsoDate;
}

export interface SignalRow {
  personId: string;
  name: string;
  status: PersonStatus;
  signal: number;
  incomingCount: number;
  firsthandCount: number;
  persona: boolean;
}

export interface CapabilityRow {
  personId: string;
  name: string;
  dimension: Dimension;
  dimensionLabel: string;
  percentile: number;
  comparisonCount: number;
  poolSize: number;
  poolConfidence: "low" | "medium" | "high";
  persona: boolean;
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

export interface DimensionView {
  dimension: Dimension;
  label: string;
  prompt: string;
  state: "estimated" | "insufficient_evidence";
  percentile: number | null;
  comparisonCount: number;
  opponentCount: number;
  poolSize: number | null;
  poolConfidence: "low" | "medium" | "high" | null;
  reason: string | null;
}

export interface ContributingView {
  referralId: string;
  referrerId: string;
  referrerName: string;
  strength: number;
  conviction: Scale5;
  confidence: Scale5;
  relationshipDepth: Scale5;
  evidenceType: EvidenceType;
  evidenceText: string;
  multiplier: number;
  reliability: number;
  bias: number;
}

export interface PersonView {
  id: string;
  name: string;
  bio: string;
  affiliation: string;
  status: PersonStatus;
  note: string | null;
  persona: boolean;
  v0Signal: number;
  v2Signal: number;
  incomingCount: number;
  firsthandCount: number;
  strongest: number | null;
  contributing: ContributingView[];
  dimensions: DimensionView[];
  gaps: GapRow[];
}

export interface GraphEdge {
  from: string;
  to: string;
  strength: number;
}

export interface GraphNode {
  id: string;
  name: string;
  status: PersonStatus;
  persona: boolean;
  v2Signal: number;
}

export interface JudgeView {
  judgeId: string;
  name: string;
  reliability: number;
  bias: number;
  meanSquaredError: number | null;
  evaluatedCount: number;
}

export interface ProposedView {
  personAId: string;
  personBId: string;
  personAName: string;
  personBName: string;
  dimension: Dimension;
  dimensionLabel: string;
  prompt: string;
  priority: number;
}

export interface TimelinePersona {
  id: string;
  name: string;
  v0: number;
  v2: number;
}

export interface TimelineFrame {
  now: IsoDate;
  evaluatedReferrals: number;
  judgesWithEvidence: number;
  windowOpen: boolean;
  personas: TimelinePersona[];
}

export interface ClubView {
  counts: {
    people: number;
    candidates: number;
    members: number;
    archived: number;
    referrals: number;
    comparisons: number;
  };
  now: IsoDate;
  windowOpen: boolean;
  observationWindowDays: number;
  evaluatedReferrals: number;
  judgesWithEvidence: number;
  topReferral: SignalRow[];
  topCapability: CapabilityRow[];
  underRecognized: GapRow[];
  people: PersonView[];
  judges: JudgeView[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  nextCompare: ProposedView | null;
  snapshots: ClubSnapshot[];
  /**
   * Monthly V2 preview on *this* club state (including slider meddles).
   * Not a precomputed seed tape — that was the bug in the Bun.serve explainer.
   */
  timeline: TimelineFrame[];
}

export interface EngineResult {
  state: ClubState;
  view: ClubView;
  error?: string;
}
