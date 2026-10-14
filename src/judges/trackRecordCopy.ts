/**
 * Display words for a judge's track-record label. No calibration imports.
 */

export type TrackRecordLabel =
  | "not_scored"
  | "unproven"
  | "calibrated"
  | "tends_to_overrate"
  | "tends_to_underrate"
  | "often_off";

export const TRACK_RECORD_COPY: Record<TrackRecordLabel, string> = {
  not_scored: "not scored",
  unproven: "unproven",
  calibrated: "calibrated",
  tends_to_overrate: "tends to overrate",
  tends_to_underrate: "tends to underrate",
  often_off: "often off",
};
