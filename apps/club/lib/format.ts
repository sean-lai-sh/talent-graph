import { PRODUCT_LANGUAGE } from "../../../src/domain/constants.ts";
import { ordinal } from "../../../src/domain/rank.ts";
import type { IsoDate } from "./types.ts";

export { ordinal };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: IsoDate): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Date without the year — the sidebar and activity rows. */
export function fmtDateShort(iso: IsoDate): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Mean of scored Referral Signals, rounded. Null when nobody is scored. */
export function cohortAverage(signals: ReadonlyArray<number | null>): number | null {
  const xs = signals.filter((n): n is number => n !== null);
  if (xs.length === 0) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/**
 * Line under the dial. Display only — not a merged score.
 * Null signal keeps the product rule: missing evidence is not a score of 0.
 */
export function signalContext(signal: number | null, average: number | null): string {
  if (signal === null) return "Missing evidence is not a score of 0.";
  if (average === null) return signalBand(signal);
  const diff = signal - average;
  if (diff === 0) return `Right at the round average of ${average}`;
  return `${Math.abs(diff)} ${diff > 0 ? "above" : "below"} the round average of ${average}`;
}

/** Rank among scored Referral Signals only. Ties take the first equal slot. */
export function scoreRank(
  signal: number | null,
  signals: ReadonlyArray<number | null>,
): { rank: number; of: number } | null {
  if (signal === null) return null;
  const scored = signals
    .filter((n): n is number => n !== null)
    .slice()
    .sort((a, b) => b - a);
  if (scored.length === 0) return null;
  const rank = scored.indexOf(signal) + 1;
  if (rank === 0) return null;
  return { rank, of: scored.length };
}

/** `2nd/13` — capability rank in its comparison pool. */
export function rankShort(percentile: number, poolSize: number): string {
  return `${ordinal(rankAmong(percentile, poolSize))}/${poolSize}`;
}

/** Mean of 1–5 conviction ratings. Null when there are no referrals. */
export function meanConviction(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function fmtDateTime(iso: IsoDate): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${fmtDate(iso)} ${hh}:${mm}`;
}

/** Integer signal or the Insufficient Evidence label. Null is never rendered as 0. */
export function signalText(signal: number | null): string {
  return signal === null ? PRODUCT_LANGUAGE.insufficientEvidence : String(signal);
}

/**
 * Coarse read of the Referral Signal. Display only — not a merged score.
 * 90–100 very strong, 70–89 strong, 50–69 promising, 30–49 mixed, below 30 early.
 */
export function signalBand(signal: number): string {
  if (signal >= 90) return "Very strong applicant";
  if (signal >= 70) return "Strong applicant";
  if (signal >= 50) return "Promising applicant";
  if (signal >= 30) return "Mixed signal";
  return "Early signal";
}

export function hoursLabel(hours: number): string {
  const h = Math.abs(hours);
  const text = h >= 48 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`;
  return hours >= 0 ? `due in ${text}` : `overdue ${text}`;
}

export function daysLabel(days: number): string {
  if (days === 0) return "today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * 1 = best in the comparison pool. Recovers rank from the engine's
 * percentile (100 → 1st, 0 → last) among members and people we've compared.
 */
export function rankAmong(percentile: number, poolSize: number): number {
  if (poolSize <= 1) return 1;
  return Math.max(
    1,
    Math.min(poolSize, Math.round(poolSize - (percentile / 100) * (poolSize - 1))),
  );
}

export function rankLabel(percentile: number, poolSize: number): string {
  return `${ordinal(rankAmong(percentile, poolSize))} of ${poolSize}`;
}
