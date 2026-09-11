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
