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

/** Pure pipeline port; the TypeSafe SDK implementation lives in the app layer. */
export interface JevJudgmentService {
  assessIdentity(
    identity: CanonicalIdentity,
    evidence: GrokEvidenceItem,
  ): Promise<IdentityAssessment>;
  assessClaim(evidence: GrokEvidenceItem): Promise<ClaimAssessment>;
}
