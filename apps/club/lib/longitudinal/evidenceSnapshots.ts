/**
 * Evidence-only snapshots at fixed dates after intake (SEA-81).
 *
 * `t` is the candidate's intake date. `G = S = 30` days.
 *
 * | kind       | evidence dated     | computed at        |
 * | ---------- | ------------------ | ------------------ |
 * | s0         | <= t + G           | t + G + S          |
 * | s12        | <= t + 12 months   | t + 12 months + S  |
 * | s24, s36   | <= t + 24/36 months| + S                |
 *
 * s24 and s36 are for pre-credential candidates. Who qualifies is step 5's
 * call, so every candidate gets them for now and step 5 filters.
 *
 * A snapshot row never changes. Evidence dated on or before a cutoff that
 * arrives after that snapshot was written adds a correction row
 * (`correctsSnapshotId`), and the head of that chain is the one read, so
 * withholding evidence cannot create movement.
 */

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

/** `G`: how long after intake evidence still counts as the starting point. */
export const GRACE_DAYS = 30;
/** `S`: how long after a cutoff late-arriving evidence is waited for. */
export const SETTLE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS: Record<Exclude<SnapshotKind, "s0">, number> = { s12: 12, s24: 24, s36: 36 };

function addMonths(at: Date, months: number): Date {
  const next = new Date(at.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  // Jan 31 + 1 month is the last day of February, not March 3.
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

/** The first snapshot not written yet and its due date, or null once s36 is written. */
export function nextSnapshot(
  intakeAt: Date,
  written: ReadonlySet<SnapshotKind>,
): { kind: SnapshotKind; dueAt: Date } | null {
  const kind = SNAPSHOT_KINDS.find((candidate) => !written.has(candidate));
  return kind === undefined ? null : { kind, dueAt: snapshotDueAt(intakeAt, kind) };
}

/** The snapshot kinds due by `now`. */
export function dueSnapshotKinds(intakeAt: Date, now: Date): SnapshotKind[] {
  return SNAPSHOT_KINDS.filter((kind) => snapshotDueAt(intakeAt, kind).getTime() <= now.getTime());
}

export interface StoredSnapshot {
  id: string;
  kind: SnapshotKind;
  inputHash: string;
  classYear: number | null;
  /** When the row was computed, by the action host's clock. Display only: never ordering. */
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

/**
 * The claims a snapshot reads: those whose evidence is dated on or before the
 * cutoff, and of each artifact only its latest version dated on or before the
 * cutoff, so an artifact with several stored versions (a GitHub repository
 * whose description grew) is never counted twice. A version is every claim
 * sharing an evidence key's `sourceId` and `publishedAt`; resume claims each
 * have a `sourceId` of their own, so for them this is the date filter alone.
 *
 * Undated claims never count, and are left out of the hash too, so a claim
 * arriving after the cutoff does not change an earlier snapshot's `inputHash`.
 */
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
  // A resume key can read "undated" (an output line with an end date only);
  // it is then the only version of its source id.
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

/**
 * The current row of a kind: the head of its correction chain, the one row no
 * other row corrects. Never `computedAt`, which is the action host's clock: a
 * correction written in the same millisecond as its original, or on a host
 * whose clock runs behind, must still supersede it. `writeSnapshots` only
 * writes a row that corrects the current head, so the chain never branches;
 * a kind with more than one head is corrupt and throws.
 */
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

/**
 * The row to write for one snapshot kind, or null when nothing changed.
 *
 * No row yet: the snapshot. A row whose evidence is the same (same
 * `inputHash`): nothing, so a rerun writes nothing. A row whose evidence
 * changed: a correction pointing at the row it supersedes.
 */
export function planSnapshot(input: {
  candidateId: string;
  kind: SnapshotKind;
  intakeAt: Date;
  now: Date;
  claims: readonly OutputOnlyClaim[];
  records: readonly JevJudgmentRecord[];
  existing: readonly StoredSnapshot[];
  /** The candidate's class year now; used only when no s0 recorded one. */
  classYear: number | null;
  newId: () => string;
}): SnapshotRow | null {
  const cutoff = evidenceCutoff(input.intakeAt, input.kind);
  const claims = claimsAtCutoff(input.claims, input.records, cutoff);
  const recordIds = new Set(claims.map((claim) => claim.recordId));
  const rollup: OutputOnlyRollup = outputOnlyRollup({
    personId: input.candidateId,
    records: input.records.filter((record) => recordIds.has(record.id)),
    claims,
    evidenceCutoff: cutoff,
  });
  const current = currentSnapshot(input.existing, input.kind);
  if (current !== null && current.inputHash === rollup.inputHash) return null;
  // Class year as recorded at s0, so every kind compares freshmen with freshmen.
  const s0 = currentSnapshot(input.existing, "s0");
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
    classYear: s0 ? s0.classYear : input.classYear,
    inputHash: rollup.inputHash,
    configHash: rollup.configHash,
  };
  if (current !== null) row.correctsSnapshotId = current.id;
  return row;
}
