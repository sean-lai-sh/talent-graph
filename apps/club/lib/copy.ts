/**
 * Badge tones for engine labels. The page uses three colours: ink (neutral),
 * accent, and danger. Other tone names remain for existing call sites and
 * collapse onto those three.
 */

import type { ReviewBucket } from "../../../src/analysis/reviewQueue.ts";
import type { TrackRecordLabel } from "../../../src/judges/trackRecord.ts";
import type { FeedbackState, ReviewStatus } from "./types.ts";

export type Tone =
  | "neutral"
  | "accent"
  | "referral"
  | "capability"
  | "rubric"
  | "gap"
  | "warn"
  | "danger"
  | "success";

export const REVIEW_STATUS_TONE: Record<ReviewStatus, Tone> = {
  new: "neutral",
  under_review: "accent",
  needs_data: "neutral",
  admitted: "accent",
  denied: "danger",
};

export const BUCKET_TONE: Record<ReviewBucket, Tone> = {
  under_recognized: "accent",
  ready_to_decide: "accent",
  single_source: "neutral",
  referred_not_compared: "neutral",
  needs_more_compares: "neutral",
  no_referrals: "neutral",
  no_evidence: "neutral",
};

export const TRACK_RECORD_TONE: Record<TrackRecordLabel, Tone> = {
  calibrated: "neutral",
  tends_to_underrate: "neutral",
  tends_to_overrate: "neutral",
  unproven: "neutral",
  not_scored: "neutral",
  often_off: "danger",
};

export const FEEDBACK_TONE: Record<FeedbackState, Tone> = {
  pending: "accent",
  overdue: "danger",
  responded: "neutral",
};
