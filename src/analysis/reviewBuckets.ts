/**
 * Bucket names and the copy a council reads. No scoring imports: the demo
 * client renders these labels, and the queue algorithm lives next door.
 */

import { PRODUCT_LANGUAGE } from "../domain/constants.ts";

/** Gap, in percentile points, large enough to flag under-recognition. */
export const INTERESTING_GAP = 25;

export type ReviewBucket =
  | "under_recognized"
  | "ready_to_decide"
  | "single_source"
  | "referred_not_compared"
  | "needs_more_compares"
  | "no_referrals"
  | "no_evidence";

export const REVIEW_BUCKET_ORDER: readonly ReviewBucket[] = [
  "under_recognized",
  "ready_to_decide",
  "single_source",
  "referred_not_compared",
  "needs_more_compares",
  "no_referrals",
  "no_evidence",
] as const;

export const REVIEW_BUCKET_COPY: Record<ReviewBucket, { label: string; description: string }> = {
  under_recognized: {
    label: "Under-recognized",
    description: `${PRODUCT_LANGUAGE.underRecognitionGap} of ${INTERESTING_GAP}+ points on at least one dimension. ${PRODUCT_LANGUAGE.exploratory}.`,
  },
  ready_to_decide: {
    label: "Ready to decide",
    description: "Two or more referrals and at least one estimated dimension.",
  },
  single_source: {
    label: "Single source",
    description: "Exactly one incoming referral. The signal rests on one judge.",
  },
  referred_not_compared: {
    label: "Referred, not compared",
    description: "Referrals exist but nobody has made an informative comparison yet.",
  },
  needs_more_compares: {
    label: "Needs more compares",
    description: `Compared, but no dimension has cleared the evidence threshold. ${PRODUCT_LANGUAGE.insufficientEvidence} on every dimension.`,
  },
  no_referrals: {
    label: "No referrals",
    description: "Compared by judges, but nobody has referred them.",
  },
  no_evidence: {
    label: "No evidence",
    description: "No referrals and no comparisons. Missing evidence is not low ability.",
  },
};
