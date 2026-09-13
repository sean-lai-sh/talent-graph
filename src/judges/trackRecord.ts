/**
 * Judge track record — a categorical label over a judge's calibration
 * estimate so a council can see whose comments to weigh without reading
 * p̂ / Ē / bias. Display heuristic, not theory (the analogue of
 * poolConfidence in inference/): the thresholds are untuned defaults and
 * the label never feeds a weight.
 *
 * Rules, in order:
 *   evaluatedCount === 0                         → not_scored
 *   evaluatedCount < spec.shrinkage (λ)          → unproven   (the prior still outweighs the evidence)
 *   √Ē ≤ CALIBRATED_MAX_RMSE and |b| ≤ DIRECTION_MIN_BIAS → calibrated
 *   |b| > DIRECTION_MIN_BIAS                     → tends_to_overrate / tends_to_underrate (sign of b)
 *   otherwise                                    → often_off   (large error, no consistent direction)
 *
 * Uses the raw running error and raw signed bias rather than the shrunk
 * values: the count gate above already encodes shrinkage. `errorScale` and
 * `priorReliability` are deliberately not read.
 */

import { CURRENT_SPECS } from "../models/registry.ts";
import type { JudgeReliabilitySpec } from "../models/spec.ts";
import type { JudgeReliabilityEstimate } from "./reliability.ts";

export type TrackRecordLabel =
  | "not_scored"
  | "unproven"
  | "calibrated"
  | "tends_to_overrate"
  | "tends_to_underrate"
  | "often_off";

export interface JudgeTrackRecord {
  label: TrackRecordLabel;
  evaluatedCount: number;
  /** Evaluated predictions needed to leave `unproven`. */
  minEvaluated: number;
}

/** Sort key: whose comments to read first. A known under-rater who praises is strong evidence. */
export const TRACK_RECORD_ORDER: Record<TrackRecordLabel, number> = {
  calibrated: 0,
  tends_to_underrate: 1,
  tends_to_overrate: 2,
  unproven: 3,
  not_scored: 4,
  often_off: 5,
};

export const TRACK_RECORD_COPY: Record<TrackRecordLabel, string> = {
  not_scored: "not scored",
  unproven: "unproven",
  calibrated: "calibrated",
  tends_to_overrate: "tends to overrate",
  tends_to_underrate: "tends to underrate",
  often_off: "often off",
};

/** √Ē at or below this (percentile-fraction units) counts as calibrated. Heuristic. */
export const CALIBRATED_MAX_RMSE = 0.35;
/** |running signed error| above this names a direction. Heuristic. */
export const DIRECTION_MIN_BIAS = 0.15;

export function judgeTrackRecord(
  e: JudgeReliabilityEstimate,
  spec: JudgeReliabilitySpec = CURRENT_SPECS.judge_reliability,
): JudgeTrackRecord {
  const minEvaluated = Math.max(1, Math.ceil(spec.shrinkage));
  const base = { evaluatedCount: e.evaluatedCount, minEvaluated };
  if (e.evaluatedCount === 0 || e.meanSquaredError === null || e.rawBias === null) {
    return { label: "not_scored", ...base };
  }
  if (e.evaluatedCount < spec.shrinkage) return { label: "unproven", ...base };
  const rmse = Math.sqrt(e.meanSquaredError);
  const bias = e.rawBias;
  if (rmse <= CALIBRATED_MAX_RMSE && Math.abs(bias) <= DIRECTION_MIN_BIAS) {
    return { label: "calibrated", ...base };
  }
  if (Math.abs(bias) > DIRECTION_MIN_BIAS) {
    return { label: bias > 0 ? "tends_to_overrate" : "tends_to_underrate", ...base };
  }
  return { label: "often_off", ...base };
}
