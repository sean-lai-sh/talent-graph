import type { CareerEventKind, IdentityDecision } from "./types.ts";

export interface AdjudicatedLongitudinalCase {
  id: string;
  expectedSamePerson: boolean;
  identityDecision: IdentityDecision;
  expectedEventKind: CareerEventKind | null;
  predictedEventKind: CareerEventKind | null;
  routedToReview: boolean;
  publishedAt: Date;
  cutoffAt: Date;
  archetype?: "quiet_compounding" | "prestigious_flat";
  residualDelta?: number | null;
}

export interface LongitudinalEvaluation {
  caseCount: number;
  identityPrecision: number;
  eventPrecision: number;
  eventRecall: number;
  reviewRate: number;
  postCutoffLeakCount: number;
  meanSourceAgeDays: number;
  quietCompoundingDetectionRate: number | null;
  prestigiousFlatFalsePositiveRate: number | null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Offline evaluation for an adjudicated two-snapshot corpus.
 *
 * This does not tune thresholds. It exposes failure rates before a pipeline
 * version is allowed to affect scout weighting.
 */
export function evaluateLongitudinalCases(
  cases: readonly AdjudicatedLongitudinalCase[],
  positiveSlopeThreshold = 0,
): LongitudinalEvaluation {
  const autoSame = cases.filter((entry) => entry.identityDecision === "same");
  const predictedEvents = cases.filter((entry) => entry.predictedEventKind !== null);
  const expectedEvents = cases.filter((entry) => entry.expectedEventKind !== null);
  const correctEvents = cases.filter(
    (entry) =>
      entry.predictedEventKind !== null && entry.predictedEventKind === entry.expectedEventKind,
  );
  const quiet = cases.filter((entry) => entry.archetype === "quiet_compounding");
  const flat = cases.filter((entry) => entry.archetype === "prestigious_flat");
  const sourceAges = cases.map(
    (entry) => (entry.cutoffAt.getTime() - entry.publishedAt.getTime()) / 86_400_000,
  );

  return {
    caseCount: cases.length,
    identityPrecision: ratio(
      autoSame.filter((entry) => entry.expectedSamePerson).length,
      autoSame.length,
    ),
    eventPrecision: ratio(correctEvents.length, predictedEvents.length),
    eventRecall: ratio(correctEvents.length, expectedEvents.length),
    reviewRate: ratio(cases.filter((entry) => entry.routedToReview).length, cases.length),
    postCutoffLeakCount: sourceAges.filter((age) => age < 0).length,
    meanSourceAgeDays:
      sourceAges.length === 0
        ? 0
        : sourceAges.reduce((sum, value) => sum + value, 0) / sourceAges.length,
    quietCompoundingDetectionRate:
      quiet.length === 0
        ? null
        : ratio(
            quiet.filter(
              (entry) =>
                entry.residualDelta !== null &&
                entry.residualDelta !== undefined &&
                entry.residualDelta > positiveSlopeThreshold,
            ).length,
            quiet.length,
          ),
    prestigiousFlatFalsePositiveRate:
      flat.length === 0
        ? null
        : ratio(
            flat.filter(
              (entry) =>
                entry.residualDelta !== null &&
                entry.residualDelta !== undefined &&
                entry.residualDelta > positiveSlopeThreshold,
            ).length,
            flat.length,
          ),
  };
}
