/**
 * In-memory data model for the Talent Graph algorithm core.
 *
 * These are TypeScript types only — DB-agnostic, so a later Prisma schema is a
 * 1:1 mapping. IDs are opaque strings. Nothing here computes anything.
 */

export type PersonStatus = "candidate" | "member" | "archived";

export type EvidenceType =
  | "firsthand_work"
  | "firsthand_personal"
  | "artifact"
  | "reputation"
  | "other";

export type Dimension =
  | "problem_solving"
  | "learning_velocity"
  | "agency"
  | "taste"
  | "output"
  | "generativity"
  | "originality";

/** Integer 1..5 slider used by referral fields and confidence. */
export type Scale5 = 1 | 2 | 3 | 4 | 5;

/** Rubric anchor 0..4. `null` in an Evaluation means "N/O" (not observed). */
export type RubricScore = 0 | 1 | 2 | 3 | 4;

export type ComparisonOutcome = "a" | "b" | "tie" | "skip" | "insufficient_observation";

export type ForecastKind = "unspecified" | "will_compound";

export interface Person {
  id: string;
  name: string;
  bio?: string;
  /** Display metadata only. No function in `src/` reads this to compute a number. */
  affiliation?: string;
  status: PersonStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Referral {
  id: string;
  referrerId: string;
  candidateId: string;
  conviction: Scale5;
  confidence: Scale5;
  relationshipDepth: Scale5;
  evidenceType: EvidenceType;
  evidenceText: string;
  /**
   * What the referrer claimed they were forecasting. Default / omitted:
   * `"unspecified"`. Only `"will_compound"` is scout-eligible later.
   * Does not enter R_uv.
   */
  forecastKind?: ForecastKind;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Structured rubric observation. Stored and summarised as an independent
 * evidence channel; it feeds **no** score in V0 or V1.
 */
export interface Evaluation {
  id: string;
  evaluatorId: string;
  candidateId: string;
  dimension: Dimension;
  /** `null` ⇒ N/O (not observed). */
  score: RubricScore | null;
  confidence: Scale5 | null;
  evidenceText: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Comparison {
  id: string;
  evaluatorId: string;
  personAId: string;
  personBId: string;
  dimension: Dimension;
  outcome: ComparisonOutcome;
  /** `personAId` for outcome "a", `personBId` for "b", `null` otherwise. */
  winnerId: string | null;
  /** Stored but ignored by the V1 likelihood. */
  confidence: Scale5 | null;
  evidenceText?: string;
  createdAt: Date;
}

/* ------------------------------------------------------------------ *
 * Longitudinal records (V2 judge calibration) and V3+ placeholders.
 * ------------------------------------------------------------------ */

/**
 * Realised result observed after a referral was made. Read by V2 judge
 * calibration (`src/judges/`): values are rank-normalised within `kind`, so
 * the unit is free-form (revenue, a rubric total, a committee grade …).
 * A `null` value records that an observation was attempted but nothing
 * measurable came of it; it is excluded from calibration.
 */
export interface Outcome {
  id: string;
  personId: string;
  opportunityId: string | null;
  kind: string;
  value: number | null;
  observedAt: Date;
  createdAt: Date;
}

/**
 * Access or support a person received. Read by V2 judge calibration to form
 * the opportunity-corrected residual R*_v = R_v − E[R_v | O_v].
 */
export interface Opportunity {
  id: string;
  personId: string;
  kind: string;
  description: string;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
}

/**
 * Judge reliability p̂_u as persisted by an application. Produced by
 * `toJudgeCalibration` in `src/judges/reliability.ts`; V0/V1 treat every
 * judge as 1.
 */
export interface JudgeCalibration {
  id: string;
  judgeId: string;
  dimension: Dimension | null;
  /** p̂_u ∈ [0,1] after shrinkage. */
  reliability: number;
  observationCount: number;
  updatedAt: Date;
}

/** Judge bias b̂_u as persisted by an application; produced alongside JudgeCalibration. */
export interface JudgeBias {
  id: string;
  judgeId: string;
  dimension: Dimension | null;
  /** Additive offset applied to a judge's comparisons. Zero in V0/V1. */
  bias: number;
  observationCount: number;
  updatedAt: Date;
}

/**
 * Reserved for V2+; no logic reads these.
 * Freezes the numbers a decision was made on, tied to ModelRun ids, so later
 * spec versions never rewrite history.
 */
export interface PredictionSnapshot {
  id: string;
  personId: string;
  modelRunIds: string[];
  values: Record<string, number | null>;
  decision: string | null;
  createdAt: Date;
}
