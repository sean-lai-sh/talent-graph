/**
 * Under-recognition gap — EXPLORATORY diagnostic.
 *
 *   U_ik = CapabilityPercentile_ik − ReferralPercentile_i
 *
 * This is the one place Referral Signal (scoring/) and Relative Capability
 * (inference/) meet. A gap exists only when both sides exist: the dimension
 * estimate is `estimated` and the person has at least one referral. Missing
 * evidence on either side yields no entry — never a gap of ±100.
 */

import { DIMENSIONS } from "../domain/constants.ts";
import type { Dimension } from "../domain/types.ts";
import type { CapabilityRun } from "../inference/capabilityVector.ts";
import { referralPercentiles } from "../scoring/referralPercentile.ts";
import type { ReferralSignalResult } from "../scoring/referralSignal.ts";

export const UNDER_RECOGNITION_NOTE =
  "Exploratory diagnostic: positive values mean comparative capability exceeds network recognition. Not a production truth.";

export interface UnderRecognition {
  personId: string;
  dimension: Dimension;
  /** capabilityPercentile − referralPercentile, in percentile points. */
  gap: number;
  capabilityPercentile: number;
  referralPercentile: number;
  tag: "exploratory";
  note: string;
}

export interface UnderRecognitionOptions {
  /** Extra floor on comparisons beyond the run's own threshold. */
  minComparisons?: number;
}

export function underRecognitionGaps(
  signals: ReadonlyMap<string, ReferralSignalResult>,
  capRun: CapabilityRun,
  opts: UnderRecognitionOptions = {},
): UnderRecognition[] {
  const refPct = referralPercentiles(signals);
  const minComparisons = opts.minComparisons ?? 0;
  const out: UnderRecognition[] = [];

  for (const [personId, vector] of capRun.vectors) {
    const referralPercentile = refPct.get(personId);
    if (referralPercentile === null || referralPercentile === undefined) continue;
    for (const dimension of DIMENSIONS) {
      const est = vector.dimensions[dimension];
      if (est.state !== "estimated") continue;
      if (est.comparisonCount < minComparisons) continue;
      out.push({
        personId,
        dimension,
        gap: est.percentile - referralPercentile,
        capabilityPercentile: est.percentile,
        referralPercentile,
        tag: "exploratory",
        note: UNDER_RECOGNITION_NOTE,
      });
    }
  }

  return out.sort(
    (a, b) =>
      b.gap - a.gap ||
      (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0) ||
      DIMENSIONS.indexOf(a.dimension) - DIMENSIONS.indexOf(b.dimension),
  );
}

/** Largest positive gaps first. */
export function mostUnderRecognized(
  gaps: readonly UnderRecognition[],
  limit = 10,
): UnderRecognition[] {
  return [...gaps].sort((a, b) => b.gap - a.gap).slice(0, limit);
}

/** Most negative gaps first (recognition exceeds comparative capability). */
export function mostOverRecognized(
  gaps: readonly UnderRecognition[],
  limit = 10,
): UnderRecognition[] {
  return [...gaps].sort((a, b) => a.gap - b.gap).slice(0, limit);
}
