import {
  evidenceDateFor,
  type OutputOnlyClaim,
  type OutputOnlyRollup,
  outputOnlyRollup,
} from "../../../../src/longitudinal/outputOnly.ts";
import type { JevJudgmentRecord } from "../../../../src/longitudinal/records.ts";
import { evidenceKeyParts } from "./evidenceSources.ts";

export const SNAPSHOT_KINDS = ["s0", "s12", "s24", "s36"] as const;
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

export const GRACE_DAYS = 30;
export const SETTLE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS: Record<Exclude<SnapshotKind, "s0">, number> = { s12: 12, s24: 24, s36: 36 };

function addMonths(at: Date, months: number): Date {
  const next = new Date(at.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
}

export function evidenceCutoff(intakeAt: Date, kind: SnapshotKind): Date {
  if (kind === "s0") return new Date(intakeAt.getTime() + GRACE_DAYS * DAY_MS);
  return addMonths(intakeAt, MONTHS[kind]);
}

export function snapshotDueAt(intakeAt: Date, kind: SnapshotKind): Date {
  return new Date(evidenceCutoff(intakeAt, kind).getTime() + SETTLE_DAYS * DAY_MS);
}

export function nextSnapshot(
  intakeAt: Date,
  written: ReadonlySet<SnapshotKind>,
): { kind: SnapshotKind; dueAt: Date } | null {
  const kind = SNAPSHOT_KINDS.find((candidate) => !written.has(candidate));
  return kind === undefined ? null : { kind, dueAt: snapshotDueAt(intakeAt, kind) };
}

export function dueSnapshotKinds(intakeAt: Date, now: Date): SnapshotKind[] {
  return SNAPSHOT_KINDS.filter((kind) => snapshotDueAt(intakeAt, kind).getTime() <= now.getTime());
}

export interface StoredSnapshot {
  id: string;
  kind: SnapshotKind;
  inputHash: string;
  classYear: number | null;
  computedAt: string;
  correctsSnapshotId?: string;
}

export interface SnapshotRow {
  id: string;
  candidateId: string;
  kind: SnapshotKind;
  evidenceCutoff: string;
  computedAt: string;
  substance: number;
  selection: number | null;
  thin: boolean;
  claimCount: number;
  classYear: number | null;
  inputHash: string;
  configHash: string;
  correctsSnapshotId?: string;
}

export function claimsAtCutoff(
  claims: readonly OutputOnlyClaim[],
  records: readonly JevJudgmentRecord[],
  cutoff: Date,
): OutputOnlyClaim[] {
  const keyByRecord = new Map(records.map((record) => [record.id, record.evidenceKey]));
  const dated = claims.flatMap((claim) => {
    const at = evidenceDateFor(claim);
    if (at === null || at.getTime() > cutoff.getTime()) return [];
    const key = keyByRecord.get(claim.recordId);
    if (key === undefined) throw new Error(`claim ${claim.id} has no record ${claim.recordId}`);
    const { sourceId, publishedAt } = evidenceKeyParts(key);
    return [{ claim, sourceId, publishedAt }];
  });
  const versionTime = (publishedAt: string) => {
    const time = Date.parse(publishedAt);
    return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
  };
  const latest = new Map<string, string>();
  for (const { sourceId, publishedAt } of dated) {
    const current = latest.get(sourceId);
    if (current === undefined || versionTime(publishedAt) > versionTime(current)) {
      latest.set(sourceId, publishedAt);
    }
  }
  return dated
    .filter(({ sourceId, publishedAt }) => latest.get(sourceId) === publishedAt)
    .map(({ claim }) => claim);
}

export function currentSnapshot<T extends StoredSnapshot>(
  rows: readonly T[],
  kind: SnapshotKind,
): T | null {
  const ofKind = rows.filter((row) => row.kind === kind);
  if (ofKind.length === 0) return null;
  const corrected = new Set(ofKind.map((row) => row.correctsSnapshotId));
  const heads = ofKind.filter((row) => !corrected.has(row.id));
  const [head] = heads;
  if (head === undefined || heads.length > 1) {
    throw new Error(
      `snapshot ${kind} of ${ofKind.length} rows has ${heads.length} heads: ${heads.map((row) => row.id).join(", ")}`,
    );
  }
  return head;
}

// A resume counts as its newest version only, so a re-upload never counts a job twice.
// Every snapshot, frozen or not, is planned from that version: a newer version's content
// dated on or before a frozen snapshot's cutoff lands there as a correction row, and
// content dated after it stays out.
export function planSnapshot(input: {
  candidateId: string;
  kind: SnapshotKind;
  intakeAt: Date;
  now: Date;
  claims: readonly OutputOnlyClaim[];
  records: readonly JevJudgmentRecord[];
  // The evidence keys of the newest resume version's claims.
  resumeKeys: ReadonlySet<string>;
  existing: readonly StoredSnapshot[];
  classYear: number | null;
  newId: () => string;
}): SnapshotRow | null {
  const current = currentSnapshot(input.existing, input.kind);
  const cutoff = evidenceCutoff(input.intakeAt, input.kind);
  const keyByRecord = new Map(input.records.map((record) => [record.id, record.evidenceKey]));
  const counted = input.claims.filter(
    (claim) =>
      claim.source !== "resume" || input.resumeKeys.has(keyByRecord.get(claim.recordId) ?? ""),
  );
  const claims = claimsAtCutoff(counted, input.records, cutoff);
  const recordIds = new Set(claims.map((claim) => claim.recordId));
  const rollup: OutputOnlyRollup = outputOnlyRollup({
    personId: input.candidateId,
    records: input.records.filter((record) => recordIds.has(record.id)),
    claims,
    evidenceCutoff: cutoff,
  });
  const s0 = currentSnapshot(input.existing, "s0");
  // classYear is an input of s0 only; later kinds copy s0's when they are written.
  const classYear = input.kind === "s0" || s0 === null ? input.classYear : s0.classYear;
  const classYearChanged =
    input.kind === "s0" && current !== null && current.classYear !== classYear;
  if (current !== null && current.inputHash === rollup.inputHash && !classYearChanged) return null;
  const row: SnapshotRow = {
    id: input.newId(),
    candidateId: input.candidateId,
    kind: input.kind,
    evidenceCutoff: cutoff.toISOString(),
    computedAt: input.now.toISOString(),
    substance: rollup.substance,
    selection: rollup.selection,
    thin: rollup.thin,
    claimCount: rollup.claimCount,
    classYear,
    inputHash: rollup.inputHash,
    configHash: rollup.configHash,
  };
  if (current !== null) row.correctsSnapshotId = current.id;
  return row;
}

// An admin's late class-year edit: a correction of the current s0 carrying the new value.
export function classYearCorrection(
  s0Rows: readonly SnapshotRow[],
  classYear: number | null,
  now: Date,
  newId: () => string,
): SnapshotRow | null {
  const head = currentSnapshot(s0Rows, "s0");
  if (head === null || head.classYear === classYear) return null;
  return {
    id: newId(),
    candidateId: head.candidateId,
    kind: "s0",
    evidenceCutoff: head.evidenceCutoff,
    computedAt: now.toISOString(),
    substance: head.substance,
    selection: head.selection,
    thin: head.thin,
    claimCount: head.claimCount,
    classYear,
    inputHash: head.inputHash,
    configHash: head.configHash,
    correctsSnapshotId: head.id,
  };
}
