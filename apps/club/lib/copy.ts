/**
 * Badge tones for engine labels. Labels themselves come from src/ (queue
 * buckets, track record) or lib/review.ts (review status); this file only
 * maps them to colours.
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
  needs_data: "warn",
  admitted: "success",
  denied: "danger",
};

export const BUCKET_TONE: Record<ReviewBucket, Tone> = {
  under_recognized: "gap",
  ready_to_decide: "accent",
  single_source: "warn",
  referred_not_compared: "neutral",
  needs_more_compares: "neutral",
  no_referrals: "neutral",
  no_evidence: "neutral",
};

export const TRACK_RECORD_TONE: Record<TrackRecordLabel, Tone> = {
  calibrated: "success",
  tends_to_underrate: "warn",
  tends_to_overrate: "warn",
  unproven: "neutral",
  not_scored: "neutral",
  often_off: "danger",
};

export const FEEDBACK_TONE: Record<FeedbackState, Tone> = {
  pending: "accent",
  overdue: "danger",
  responded: "success",
};
