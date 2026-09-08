/**
 * Aggregate summaries and the text "person report" for a future UI (and
 * for `bun run demo`). Pure formatting over already-computed results; no
 * score is computed here.
 */

import { DIMENSIONS, PRODUCT_LANGUAGE } from "../domain/constants.ts";
import { ordinal } from "../domain/rank.ts";
import type { Comparison, Dimension, Evaluation, Person, Referral } from "../domain/types.ts";
import {
  type CapabilityRun,
  dimensionLabel,
  estimatedEntries,
} from "../inference/capabilityVector.ts";
import { displayReferralSignal, type ReferralSignalResult } from "../scoring/referralSignal.ts";
import { referralStrengthBreakdown } from "../scoring/referralStrength.ts";
import { mostUnderRecognized, type UnderRecognition } from "./underRecognition.ts";

export interface DashboardData {
  people: readonly Person[];
  referrals: readonly Referral[];
  evaluations: readonly Evaluation[];
  comparisons: readonly Comparison[];
}

export interface DashboardSummary {
  people: number;
  candidates: number;
  members: number;
  archived: number;
  referrals: number;
  comparisons: number;
  evaluations: number;
  /** 10 newest. */
  recentReferrals: Referral[];
  /** 10 highest Referral Signals among people with ≥1 referral. */
  topReferralSignal: ReferralSignalResult[];
  /** 10 highest capability percentiles; estimated entries only. */
  topCapability: Array<{
    personId: string;
    dimension: Dimension;
    percentile: number;
    comparisonCount: number;
  }>;
  /** 10 largest positive under-recognition gaps (exploratory). */
  underRecognized: UnderRecognition[];
}

export function buildDashboard(
  data: DashboardData,
  signals: ReadonlyMap<string, ReferralSignalResult>,
  capRun: CapabilityRun,
  gaps: readonly UnderRecognition[],
): DashboardSummary {
  const byStatus = (s: Person["status"]) => data.people.filter((p) => p.status === s).length;

  const recentReferrals = [...data.referrals]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1))
    .slice(0, 10);

  const topReferralSignal = [...signals.values()]
    .filter((r) => r.incomingCount >= 1)
    .sort((a, b) => b.signal - a.signal || (a.personId < b.personId ? -1 : 1))
    .slice(0, 10);

  const topCapability = estimatedEntries(capRun)
    .map(({ personId, estimate }) => ({
      personId,
      dimension: estimate.dimension,
      percentile: estimate.percentile,
      comparisonCount: estimate.comparisonCount,
    }))
    .sort(
      (a, b) =>
        b.percentile - a.percentile ||
        b.comparisonCount - a.comparisonCount ||
        (a.personId < b.personId ? -1 : 1),
    )
    .slice(0, 10);

  return {
    people: data.people.length,
    candidates: byStatus("candidate"),
    members: byStatus("member"),
    archived: byStatus("archived"),
    referrals: data.referrals.length,
    comparisons: data.comparisons.length,
    evaluations: data.evaluations.length,
    recentReferrals,
    topReferralSignal,
    topCapability,
    underRecognized: mostUnderRecognized(gaps, 10),
  };
}

/** Gap at or above this is called out in the person report. */
export const INTERESTING_GAP = 25;

/**
 * Plain-text report for one person, in the shape of the MVP prompt §41.
 * Names are display metadata; nothing here feeds back into a number.
 */
export function personReport(
  personId: string,
  data: DashboardData,
  signals: ReadonlyMap<string, ReferralSignalResult>,
  capRun: CapabilityRun,
  gaps: readonly UnderRecognition[],
): string {
  const person = data.people.find((p) => p.id === personId);
  const nameOf = (id: string) => data.people.find((p) => p.id === id)?.name ?? id;
  const signal = signals.get(personId);
  const vector = capRun.vectors.get(personId);
  const lines: string[] = [];

  lines.push(person?.name ?? personId);
  lines.push(PRODUCT_LANGUAGE.referralSignal);
  if (!signal) {
    lines.push("(no referral data)");
  } else {
    lines.push(`${displayReferralSignal(signal)} / 100`);
    const strongest = signal.strongest === null ? "—" : signal.strongest.toFixed(2);
    lines.push(
      `${signal.incomingCount} incoming referral${signal.incomingCount === 1 ? "" : "s"} · ${signal.firsthandCount} firsthand · strongest ${strongest}`,
    );
    if (signal.contributing.length > 0) {
      lines.push("Why:");
      for (const { referral, strength } of signal.contributing) {
        const b = referralStrengthBreakdown(referral);
        lines.push(
          `  ${nameOf(referral.referrerId)} → ${strength.toFixed(2)} · ${referral.conviction}/${referral.confidence}/${referral.relationshipDepth} · ${referral.evidenceType} (×${b.multiplier})`,
        );
      }
    }
  }

  lines.push("");
  lines.push(PRODUCT_LANGUAGE.relativeCapability);
  if (!vector) {
    lines.push("(no comparison data)");
  } else {
    for (const d of DIMENSIONS) {
      const e = vector.dimensions[d];
      const label = dimensionLabel(d).padEnd(20);
      if (e.state === "estimated") {
        lines.push(
          `${label}${ordinal(e.percentile)} percentile · ${e.comparisonCount} comparison${e.comparisonCount === 1 ? "" : "s"} · ${e.opponentCount} opponent${e.opponentCount === 1 ? "" : "s"} · pool: ${e.poolSize} people, ${e.poolConfidence} confidence`,
        );
      } else {
        lines.push(`${label}${PRODUCT_LANGUAGE.insufficientEvidence} (${e.reason})`);
      }
    }
  }

  const own = gaps.filter((g) => g.personId === personId);
  const biggest = own.reduce<UnderRecognition | null>(
    (best, g) => (best === null || g.gap > best.gap ? g : best),
    null,
  );
  if (biggest && biggest.gap >= INTERESTING_GAP) {
    lines.push("");
    lines.push(
      `Interesting signal: pairwise capability estimate substantially exceeds referral recognition (gap +${Math.round(biggest.gap)} on ${biggest.dimension}) · ${PRODUCT_LANGUAGE.exploratory}`,
    );
  }

  return lines.join("\n");
}

/** Compact multi-line dashboard text for the demo. */
export function formatDashboard(summary: DashboardSummary, people: readonly Person[]): string {
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  const lines = [
    "Talent Graph — dashboard",
    `People ${summary.people} (candidates ${summary.candidates}, members ${summary.members}, archived ${summary.archived}) · referrals ${summary.referrals} · comparisons ${summary.comparisons} · rubric evaluations ${summary.evaluations}`,
    "",
    `Top ${PRODUCT_LANGUAGE.referralSignal}:`,
    ...summary.topReferralSignal.map(
      (r) =>
        `  ${nameOf(r.personId).padEnd(18)} ${String(displayReferralSignal(r)).padStart(3)} / 100 · ${r.incomingCount} referrals`,
    ),
    "",
    `Top ${PRODUCT_LANGUAGE.relativeCapability}s:`,
    ...summary.topCapability.map(
      (c) =>
        `  ${nameOf(c.personId).padEnd(18)} ${dimensionLabel(c.dimension).padEnd(18)} ${ordinal(c.percentile).padStart(5)} percentile · ${c.comparisonCount} comparisons`,
    ),
    "",
    `${PRODUCT_LANGUAGE.underRecognitionGap} (${PRODUCT_LANGUAGE.exploratory}):`,
    ...summary.underRecognized.map(
      (u) =>
        `  ${nameOf(u.personId).padEnd(18)} ${dimensionLabel(u.dimension).padEnd(18)} ${u.gap >= 0 ? "+" : ""}${u.gap.toFixed(0)} (capability ${ordinal(u.capabilityPercentile)}, referral ${ordinal(u.referralPercentile)})`,
    ),
  ];
  return lines.join("\n");
}
