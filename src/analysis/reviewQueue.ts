/**
 * Review queue — categorical buckets over both channels for a council that
 * is deciding who to look at next. This is presentation of evidence *state*,
 * not a score: no number from scoring/ is combined with any number from
 * inference/. Every bucket is defined by counts and by the engine's own
 * estimate states, plus the existing INTERESTING_GAP threshold.
 *
 * Precedence (first match wins):
 *   no_evidence            0 incoming, 0 informative comparisons
 *   no_referrals           0 incoming, ≥1 informative comparison
 *   referred_not_compared  ≥1 incoming, 0 informative comparisons
 *   under_recognized       any under-recognition gap ≥ INTERESTING_GAP
 *   single_source          exactly 1 incoming referral
 *   ready_to_decide        ≥2 incoming and ≥1 estimated dimension
 *   needs_more_compares    everything else (≥2 incoming, comparisons, 0 estimated)
 *
 * `flags` lists every condition that holds so a person in one bucket can
 * still carry the others as context (Cleo: under_recognized + single_source).
 */

import { DIMENSIONS, PRODUCT_LANGUAGE } from "../domain/constants.ts";
import type { Person, PersonStatus } from "../domain/types.ts";
import { type CapabilityRun, dimensionLabel } from "../inference/capabilityVector.ts";
import type { ReferralSignalResult } from "../scoring/referralSignal.ts";
import { INTERESTING_GAP } from "./dashboard.ts";
import type { UnderRecognition } from "./underRecognition.ts";

export type ReviewBucket =
  | "under_recognized"
  | "ready_to_decide"
  | "single_source"
  | "referred_not_compared"
  | "needs_more_compares"
  | "no_referrals"
  | "no_evidence";

export interface ReviewEntry {
  personId: string;
  bucket: ReviewBucket;
  /** Every bucket condition that holds, in REVIEW_BUCKET_ORDER. */
  flags: ReviewBucket[];
  /** Factual strings built only from counts and estimate states. */
  reasons: string[];
  incomingCount: number;
  firsthandCount: number;
  informativeComparisons: number;
  estimatedDimensions: number;
  largestGap: UnderRecognition | null;
}

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

export interface ReviewQueueInput {
  people: readonly Person[];
  signals: ReadonlyMap<string, ReferralSignalResult>;
  capRun: CapabilityRun;
  gaps: readonly UnderRecognition[];
  /** Default: candidates only. */
  statuses?: readonly PersonStatus[];
}

const DEFAULT_STATUSES: readonly PersonStatus[] = ["candidate"];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function buildReviewQueue(input: ReviewQueueInput): ReviewEntry[] {
  const statuses = new Set(input.statuses ?? DEFAULT_STATUSES);
  const gapsByPerson = new Map<string, UnderRecognition[]>();
  for (const g of input.gaps) {
    const list = gapsByPerson.get(g.personId);
    if (list) list.push(g);
    else gapsByPerson.set(g.personId, [g]);
  }

  const entries: ReviewEntry[] = [];
  for (const person of input.people) {
    if (!statuses.has(person.status)) continue;
    const signal = input.signals.get(person.id);
    const incomingCount = signal?.incomingCount ?? 0;
    const firsthandCount = signal?.firsthandCount ?? 0;
    const vector = input.capRun.vectors.get(person.id);
    let informative = 0;
    let estimated = 0;
    const insufficient: string[] = [];
    for (const d of DIMENSIONS) {
      const e = vector?.dimensions[d];
      if (!e) continue;
      informative += e.comparisonCount;
      if (e.state === "estimated") estimated++;
      else insufficient.push(d);
    }
    const largestGap = (gapsByPerson.get(person.id) ?? []).reduce<UnderRecognition | null>(
      (best, g) => (best === null || g.gap > best.gap ? g : best),
      null,
    );
    const hasGap = largestGap !== null && largestGap.gap >= INTERESTING_GAP;

    const holds: Record<ReviewBucket, boolean> = {
      no_evidence: incomingCount === 0 && informative === 0,
      no_referrals: incomingCount === 0 && informative > 0,
      referred_not_compared: incomingCount >= 1 && informative === 0,
      under_recognized: hasGap,
      single_source: incomingCount === 1,
      ready_to_decide: incomingCount >= 2 && estimated >= 1,
      needs_more_compares: incomingCount >= 2 && informative > 0 && estimated === 0,
    };
    const precedence: readonly ReviewBucket[] = [
      "no_evidence",
      "no_referrals",
      "referred_not_compared",
      "under_recognized",
      "single_source",
      "ready_to_decide",
      "needs_more_compares",
    ];
    const bucket = precedence.find((b) => holds[b]) ?? "needs_more_compares";
    const flags = REVIEW_BUCKET_ORDER.filter((b) => holds[b]);

    const reasons: string[] = [];
    reasons.push(
      incomingCount === 0
        ? "no incoming referrals"
        : `${plural(incomingCount, "incoming referral")} · ${firsthandCount} firsthand`,
    );
    reasons.push(
      informative === 0
        ? "no informative comparisons"
        : `${plural(informative, "informative comparison")} · ${estimated} of ${DIMENSIONS.length} dimensions estimated`,
    );
    if (hasGap && largestGap) {
      reasons.push(
        `${dimensionLabel(largestGap.dimension)}: capability ${Math.round(largestGap.capabilityPercentile)}th vs referral ${Math.round(largestGap.referralPercentile)}th, +${Math.round(largestGap.gap)}`,
      );
    }

    entries.push({
      personId: person.id,
      bucket,
      flags,
      reasons,
      incomingCount,
      firsthandCount,
      informativeComparisons: informative,
      estimatedDimensions: estimated,
      largestGap,
    });
  }

  const rank = new Map(REVIEW_BUCKET_ORDER.map((b, i) => [b, i] as const));
  entries.sort((a, b) => {
    const byBucket = (rank.get(a.bucket) ?? 0) - (rank.get(b.bucket) ?? 0);
    if (byBucket !== 0) return byBucket;
    if (a.bucket === "under_recognized") {
      const ga = a.largestGap?.gap ?? 0;
      const gb = b.largestGap?.gap ?? 0;
      if (gb !== ga) return gb - ga;
    }
    return (
      b.incomingCount - a.incomingCount ||
      b.estimatedDimensions - a.estimatedDimensions ||
      (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0)
    );
  });
  return entries;
}

/** Non-empty buckets in REVIEW_BUCKET_ORDER. */
export function groupReviewQueue(
  entries: readonly ReviewEntry[],
): Array<{ bucket: ReviewBucket; entries: ReviewEntry[] }> {
  return REVIEW_BUCKET_ORDER.map((bucket) => ({
    bucket,
    entries: entries.filter((e) => e.bucket === bucket),
  })).filter((g) => g.entries.length > 0);
}
