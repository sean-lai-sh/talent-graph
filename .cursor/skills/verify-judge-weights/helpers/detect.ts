/**
 * Engine checks turn on only when the merged code is in this checkout.
 * No env var or manual flag can enable them.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SKIP_ADMISSION = "SKIPPED - needs #120 on main";
export const SKIP_SNAPSHOTS = "SKIPPED - needs #122 on main";
export const SKIP_REFERRAL_SIGNAL = "SKIPPED - needs #123 on main";

export type CheckId = "admin-only-weights" | "admission-credit" | "snapshots" | "referral-signal";

export type CheckResult =
  | { id: CheckId; status: "pass"; detail: string }
  | { id: CheckId; status: "fail"; detail: string }
  | { id: CheckId; status: "skipped"; detail: string };

export type Tally = { passed: number; skipped: number; failed: number };

export function tally(results: readonly CheckResult[]): Tally {
  return {
    passed: results.filter((result) => result.status === "pass").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "fail").length,
  };
}

export function formatResult(result: CheckResult): string {
  if (result.status === "skipped") return result.detail;
  if (result.status === "pass") return `PASS ${result.id}`;
  return `FAIL ${result.id}: ${result.detail}`;
}

export function formatReport(results: readonly CheckResult[]): string {
  const lines = results.map(formatResult);
  const counts = tally(results);
  lines.push("");
  lines.push(`passed ${counts.passed}`);
  lines.push(`skipped ${counts.skipped}`);
  lines.push(`failed ${counts.failed}`);
  return `${lines.join("\n")}\n`;
}

function hasExport(root: string, rel: string, marker: string): boolean {
  const path = join(root, rel);
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").includes(marker);
}

/** #120 admission credit: the functions and the decidedBy field, not a flag. */
export function admissionPresent(root: string): boolean {
  return (
    hasExport(root, "src/judges/admission.ts", "export function computeAdmission") &&
    hasExport(root, "src/judges/admission.ts", "decidedBy") &&
    hasExport(root, "src/scoring/signalWithout.ts", "export function signalWithoutEachReferrer") &&
    hasExport(root, "apps/club/lib/engine/admission.ts", "export function admissionObservations") &&
    hasExport(root, "apps/club/lib/engine/transitions.ts", "decidedBy")
  );
}

/** #122 snapshots: planner, thin flag, and the daily cron. */
export function snapshotsPresent(root: string): boolean {
  return (
    hasExport(
      root,
      "apps/club/lib/longitudinal/evidenceSnapshots.ts",
      "export function planSnapshot",
    ) &&
    hasExport(root, "apps/club/lib/longitudinal/evidenceSnapshots.ts", "thin:") &&
    hasExport(root, "apps/club/convex/crons.ts", "internal.evidence.daily") &&
    hasExport(root, "apps/club/convex/evidence.ts", "export const daily")
  );
}

/** #123 weight-normalised Referral Signal. */
export function referralSignalPresent(root: string): boolean {
  return (
    hasExport(root, "src/models/registry.ts", "export const REFERRAL_SIGNAL_V0_2_0") &&
    hasExport(root, "src/judges/reliability.ts", "export function judgePseudoWeight") &&
    hasExport(root, "src/scoring/referralSignal.ts", "pseudoWeight")
  );
}
