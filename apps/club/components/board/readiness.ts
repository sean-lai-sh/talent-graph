import { PRODUCT_LANGUAGE } from "../../../../src/domain/constants.ts";
import type { PersonView } from "../../lib/types.ts";

export type ReadinessTag = "Ready" | "Needs compares" | "Needs referrals";

/** Evidence buckets used only to order a review queue. Not a score. */
export type ReadinessRank = 0 | 1 | 2 | 3;

export interface Readiness {
  rank: ReadinessRank;
  tag: ReadinessTag;
  hasReferrals: boolean;
  hasEstimatedDimension: boolean;
  hasCompares: boolean;
}

export function comparisonCountOf(person: PersonView): number {
  return person.dimensions.reduce((n, d) => n + d.comparisonCount, 0);
}

export function hasEstimatedDimension(person: PersonView): boolean {
  return person.dimensions.some((d) => d.state === "estimated");
}

export function readinessOf(person: PersonView): Readiness {
  const hasReferrals = person.incomingCount >= 1;
  const estimated = hasEstimatedDimension(person);
  const hasCompares = person.dimensions.some((d) => d.comparisonCount > 0);

  if (hasReferrals && estimated) {
    return { rank: 0, tag: "Ready", hasReferrals, hasEstimatedDimension: estimated, hasCompares };
  }
  if (hasReferrals) {
    return {
      rank: 1,
      tag: "Needs compares",
      hasReferrals,
      hasEstimatedDimension: estimated,
      hasCompares,
    };
  }
  if (hasCompares) {
    return {
      rank: 2,
      tag: "Needs referrals",
      hasReferrals,
      hasEstimatedDimension: estimated,
      hasCompares,
    };
  }
  return {
    rank: 3,
    tag: "Needs referrals",
    hasReferrals,
    hasEstimatedDimension: estimated,
    hasCompares,
  };
}

export function sortByReadiness(people: PersonView[]): PersonView[] {
  return [...people].sort((a, b) => {
    const rank = readinessOf(a).rank - readinessOf(b).rank;
    return rank || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

export function isExploratory(person: PersonView): boolean {
  return person.gaps.length > 0;
}

export function largestGap(person: PersonView): number | null {
  if (person.gaps.length === 0) return null;
  return person.gaps.reduce((max, g) => (g.gap > max ? g.gap : max), Number.NEGATIVE_INFINITY);
}

export function referralSignalLabel(person: PersonView): string {
  const measured = person.incomingCount >= 1 && person.v2Signal !== null;
  return measured ? String(person.v2Signal) : PRODUCT_LANGUAGE.insufficientEvidence;
}

export function nextQueueId(queue: readonly { id: string }[], currentId: string): string {
  const i = queue.findIndex((p) => p.id === currentId);
  if (i === -1) return queue[0]?.id ?? "";
  return queue[i + 1]?.id ?? queue[i - 1]?.id ?? "";
}

export type SortChip = "loudest" | "evidence" | "underRecognized" | "newest";

/** Each chip sorts on one axis only. Never a combined score. */
export function sortByChip(
  people: PersonView[],
  chip: SortChip,
  createdAtById: Map<string, string>,
): PersonView[] {
  return [...people].sort((a, b) => {
    if (chip === "loudest") {
      const as = a.v2Signal ?? Number.NEGATIVE_INFINITY;
      const bs = b.v2Signal ?? Number.NEGATIVE_INFINITY;
      return bs - as || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    }
    if (chip === "evidence") {
      return (
        comparisonCountOf(b) - comparisonCountOf(a) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
      );
    }
    if (chip === "underRecognized") {
      const ag = largestGap(a) ?? Number.NEGATIVE_INFINITY;
      const bg = largestGap(b) ?? Number.NEGATIVE_INFINITY;
      return bg - ag || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    }
    const at = createdAtById.get(a.id) ?? "";
    const bt = createdAtById.get(b.id) ?? "";
    return bt.localeCompare(at) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
