/**
 * Drift report — measure a model change before anyone sees it.
 *
 * Compares two runs on the *same* raw data (typically an old spec version
 * versus a new one) and summarises how much the ordering and the numbers
 * moved: Kendall τ_b, Spearman ρ, top-K Jaccard, shift distribution, people
 * who crossed the insufficient-evidence boundary (and the fraction of the
 * valued population they represent), and the largest movers.
 *
 * Referral Signal is compared in `signal` space (0–100); capability in
 * percentile space per dimension. The verdict thresholds are heuristics,
 * documented as such; they gate a CHANGELOG entry, not the theory.
 */

import { rankPercentiles } from "../domain/rank.ts";
import type { Dimension } from "../domain/types.ts";
import type { CapabilityRun } from "../inference/capabilityVector.ts";
import type { ReferralSignalResult } from "../scoring/referralSignal.ts";

export interface DriftThresholds {
  /** Default 0.9. */
  minKendallTau: number;
  /** Default 0.7. */
  minTop10Jaccard: number;
  /** Default 10 (points, in the compared value's units). */
  maxP95Shift: number;
  /**
   * Default 0.1. Upper bound on `crossedFraction`: the share of people whose
   * value appeared or disappeared across the insufficient-evidence boundary.
   * Rank statistics see only people valued on both sides, so without this a
   * change that silently drops a third of the population could read as stable.
   */
  maxCrossedFraction: number;
}

export const DEFAULT_DRIFT_THRESHOLDS: DriftThresholds = Object.freeze({
  minKendallTau: 0.9,
  minTop10Jaccard: 0.7,
  maxP95Shift: 10,
  maxCrossedFraction: 0.1,
});

/** Beyond these the change is `breaking` regardless of the other thresholds. */
export const BREAKING_KENDALL_TAU = 0.7;
export const BREAKING_TOP10_JACCARD = 0.4;
export const BREAKING_CROSSED_FRACTION = 0.3;

export type DriftVerdict = "stable" | "review" | "breaking";

export interface DriftMover {
  personId: string;
  before: number | null;
  after: number | null;
  delta: number;
}

export interface DriftReport {
  kind: "referral_signal" | "bradley_terry";
  dimension?: Dimension;
  /** People with a value on both sides. */
  n: number;
  spearman: number;
  kendallTau: number;
  topKJaccard: Record<10 | 25, number>;
  maxAbsShift: number;
  meanAbsShift: number;
  p95AbsShift: number;
  /** Ids that became estimable (gained) or stopped being estimable (lost). */
  crossedInsufficiency: { gained: string[]; lost: string[] };
  /** (gained + lost) / (n + gained + lost); 0 when nobody is valued on either side. */
  crossedFraction: number;
  /** Ten largest |delta| among people valued on both sides. */
  largestMovers: DriftMover[];
  verdict: DriftVerdict;
  thresholds: DriftThresholds;
  labels: { before: string; after: string };
}

/* ------------------------------------------------------------------ *
 * Statistics
 * ------------------------------------------------------------------ */

/** Kendall τ_b: ties on either side are handled so identical inputs give exactly 1. */
export function kendallTauB(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  if (n < 2) return 1;
  let concordant = 0;
  let discordant = 0;
  let tiesX = 0;
  let tiesY = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign((x[i] as number) - (x[j] as number));
      const dy = Math.sign((y[i] as number) - (y[j] as number));
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) tiesX++;
      else if (dy === 0) tiesY++;
      else if (dx === dy) concordant++;
      else discordant++;
    }
  }
  const n0 = (n * (n - 1)) / 2;
  const n1 = tiesX;
  const n2 = tiesY;
  // Pairs tied on both sides are excluded from n0 entirely.
  const bothTied = n0 - concordant - discordant - tiesX - tiesY;
  const denom = Math.sqrt((n0 - bothTied - n1) * (n0 - bothTied - n2));
  if (denom === 0) return 1;
  return (concordant - discordant) / denom;
}

/** Spearman ρ on average ranks. */
export function spearmanRho(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  if (n < 2) return 1;
  const rx = averageRanks(x);
  const ry = averageRanks(y);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (rx[i] as number) - mx;
    const dy = (ry[i] as number) - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return 1;
  return cov / Math.sqrt(vx * vy);
}

function averageRanks(values: readonly number[]): number[] {
  const ids = values.map((_, i) => String(i));
  const pct = rankPercentiles(ids.map((id, i) => ({ id, value: values[i] as number })));
  // rankPercentiles returns 0..100; any affine transform keeps ρ identical.
  return ids.map((id) => pct.get(id) ?? 0);
}

/** Jaccard of the top-k id sets by value (desc). k is capped at n. */
export function topKJaccard(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
  k: number,
): number {
  const top = (m: ReadonlyMap<string, number>): Set<string> =>
    new Set(
      [...m.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, Math.min(k, m.size))
        .map(([id]) => id),
    );
  const a = top(before);
  const b = top(after);
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const id of a) if (b.has(id)) inter++;
  return inter / (a.size + b.size - inter);
}

function quantile(sortedAsc: readonly number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const pos = q * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sortedAsc[lo] as number;
  const b = sortedAsc[hi] as number;
  return a + (b - a) * (pos - lo);
}

/* ------------------------------------------------------------------ *
 * Report assembly
 * ------------------------------------------------------------------ */

function buildReport(
  kind: DriftReport["kind"],
  before: ReadonlyMap<string, number | null>,
  after: ReadonlyMap<string, number | null>,
  thresholds: DriftThresholds,
  labels: { before: string; after: string },
  dimension?: Dimension,
): DriftReport {
  const ids = new Set([...before.keys(), ...after.keys()]);
  const sharedIds: string[] = [];
  const gained: string[] = [];
  const lost: string[] = [];
  for (const id of [...ids].sort()) {
    const b = before.get(id) ?? null;
    const a = after.get(id) ?? null;
    if (b !== null && a !== null) sharedIds.push(id);
    else if (b === null && a !== null) gained.push(id);
    else if (b !== null && a === null) lost.push(id);
  }

  const xs = sharedIds.map((id) => before.get(id) as number);
  const ys = sharedIds.map((id) => after.get(id) as number);
  const beforeShared = new Map(sharedIds.map((id, i) => [id, xs[i] as number]));
  const afterShared = new Map(sharedIds.map((id, i) => [id, ys[i] as number]));

  const shifts = sharedIds.map((id, i) => ({
    personId: id,
    before: xs[i] as number,
    after: ys[i] as number,
    delta: (ys[i] as number) - (xs[i] as number),
  }));
  const absSorted = shifts.map((s) => Math.abs(s.delta)).sort((a, b) => a - b);

  const kendallTau = kendallTauB(xs, ys);
  const top10 = topKJaccard(beforeShared, afterShared, 10);
  const top25 = topKJaccard(beforeShared, afterShared, 25);
  const p95AbsShift = quantile(absSorted, 0.95);
  const crossed = gained.length + lost.length;
  const crossedDenominator = sharedIds.length + crossed;
  const crossedFraction = crossedDenominator === 0 ? 0 : crossed / crossedDenominator;

  let verdict: DriftVerdict;
  if (
    kendallTau < BREAKING_KENDALL_TAU ||
    top10 < BREAKING_TOP10_JACCARD ||
    crossedFraction > BREAKING_CROSSED_FRACTION
  )
    verdict = "breaking";
  else if (
    kendallTau >= thresholds.minKendallTau &&
    top10 >= thresholds.minTop10Jaccard &&
    p95AbsShift <= thresholds.maxP95Shift &&
    crossedFraction <= thresholds.maxCrossedFraction
  )
    verdict = "stable";
  else verdict = "review";

  const report: DriftReport = {
    kind,
    n: sharedIds.length,
    spearman: spearmanRho(xs, ys),
    kendallTau,
    topKJaccard: { 10: top10, 25: top25 },
    maxAbsShift: absSorted.length ? (absSorted[absSorted.length - 1] as number) : 0,
    meanAbsShift: absSorted.length ? absSorted.reduce((a, b) => a + b, 0) / absSorted.length : 0,
    p95AbsShift,
    crossedInsufficiency: { gained, lost },
    crossedFraction,
    largestMovers: [...shifts]
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.personId < b.personId ? -1 : 1))
      .slice(0, 10),
    verdict,
    thresholds,
    labels,
  };
  if (dimension !== undefined) report.dimension = dimension;
  return report;
}

/** Drift between two Referral Signal runs on the same data (signal space, 0–100). */
export function referralSignalDrift(
  before: ReadonlyMap<string, ReferralSignalResult>,
  after: ReadonlyMap<string, ReferralSignalResult>,
  thresholds: DriftThresholds = DEFAULT_DRIFT_THRESHOLDS,
): DriftReport {
  const toValues = (m: ReadonlyMap<string, ReferralSignalResult>) =>
    new Map<string, number | null>(
      [...m.entries()].map(([id, r]) => [id, r.incomingCount >= 1 ? r.signal : null]),
    );
  const labels = {
    before: [...before.values()][0]?.specVersion ?? "?",
    after: [...after.values()][0]?.specVersion ?? "?",
  };
  return buildReport("referral_signal", toValues(before), toValues(after), thresholds, labels);
}

/** Drift between two capability runs on one dimension (percentile space). */
export function capabilityDrift(
  before: CapabilityRun,
  after: CapabilityRun,
  dimension: Dimension,
  thresholds: DriftThresholds = DEFAULT_DRIFT_THRESHOLDS,
): DriftReport {
  const toValues = (run: CapabilityRun) =>
    new Map<string, number | null>(
      [...run.vectors.entries()].map(([id, v]) => {
        const e = v.dimensions[dimension];
        return [id, e.state === "estimated" ? e.percentile : null];
      }),
    );
  return buildReport(
    "bradley_terry",
    toValues(before),
    toValues(after),
    thresholds,
    { before: before.options.specVersion, after: after.options.specVersion },
    dimension,
  );
}

const fmt = (x: number, d = 3) => x.toFixed(d);

export function formatDriftReport(r: DriftReport): string {
  const head = r.dimension ? `${r.kind} · ${r.dimension}` : r.kind;
  const lines = [
    `Drift report — ${head} (${r.labels.before} → ${r.labels.after})`,
    `Verdict: ${r.verdict.toUpperCase()}   n=${r.n}`,
    `Kendall τ_b ${fmt(r.kendallTau)} (min ${r.thresholds.minKendallTau}, breaking < ${BREAKING_KENDALL_TAU}) · Spearman ρ ${fmt(r.spearman)}`,
    `Top-10 Jaccard ${fmt(r.topKJaccard[10], 2)} (min ${r.thresholds.minTop10Jaccard}, breaking < ${BREAKING_TOP10_JACCARD}) · Top-25 Jaccard ${fmt(r.topKJaccard[25], 2)}`,
    `|shift| mean ${fmt(r.meanAbsShift, 2)} · p95 ${fmt(r.p95AbsShift, 2)} (max allowed ${r.thresholds.maxP95Shift}) · max ${fmt(r.maxAbsShift, 2)}`,
    `Crossed insufficiency: ${fmt(r.crossedFraction, 2)} of ${r.n + r.crossedInsufficiency.gained.length + r.crossedInsufficiency.lost.length} (max ${r.thresholds.maxCrossedFraction}, breaking > ${BREAKING_CROSSED_FRACTION}) · gained ${r.crossedInsufficiency.gained.length}${
      r.crossedInsufficiency.gained.length ? ` [${r.crossedInsufficiency.gained.join(", ")}]` : ""
    } · lost ${r.crossedInsufficiency.lost.length}${
      r.crossedInsufficiency.lost.length ? ` [${r.crossedInsufficiency.lost.join(", ")}]` : ""
    }`,
  ];
  if (r.largestMovers.length > 0) {
    lines.push("Largest movers:");
    for (const m of r.largestMovers) {
      const sign = m.delta >= 0 ? "+" : "";
      lines.push(
        `  ${m.personId.padEnd(10)} ${fmt(m.before ?? 0, 1).padStart(6)} → ${fmt(m.after ?? 0, 1).padStart(6)}  (${sign}${fmt(m.delta, 1)})`,
      );
    }
  }
  return lines.join("\n");
}
