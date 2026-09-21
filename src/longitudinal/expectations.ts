/**
 * What a record has to be, to be the observation a request is asking for —
 * and the write that puts one there.
 *
 * Every path that accepts a record from a store — a cache hit, and the re-read
 * after a write that lost a race — comes through here. A store that answers
 * with something else is a bug to be shouted about, not a cheaper judgment and
 * not an unavailable one.
 */

import { careerEvidenceSpecId } from "../models/careerEvidence.ts";
import type { CareerEvidenceSpec } from "../models/spec.ts";
import type { JevJudgmentRecord } from "./records.ts";
import { evidenceKeyFor, JudgmentInvariantError, recordIdFor, rubricHashOf } from "./records.ts";
import type { JevJudgmentStore } from "./store.ts";
import type { GrokEvidenceItem } from "./types.ts";

/**
 * What a record has to be, to be the observation this request is asking for.
 *
 * Every path that accepts a record from a store — a cache hit, and the
 * re-read after a write that lost a race — checks it against this. A store
 * that answers with something else is a bug to be shouted about, not a
 * cheaper judgment and not an unavailable one.
 */
export interface RecordExpectation {
  /** `recordIdFor(fingerprint, evidenceKey)`: the address, and the id. */
  id: string;
  kind: JevJudgmentRecord["kind"];
  fingerprint: string;
  personId: string;
  evidenceKey: string;
  /** The rubric half of the spec id; the version is deliberately not compared. */
  rubricHash: string;
}

export function expectationFor(input: {
  fingerprint: string;
  kind: JevJudgmentRecord["kind"];
  personId: string;
  evidence: GrokEvidenceItem;
  spec: CareerEvidenceSpec;
}): RecordExpectation {
  const evidenceKey = evidenceKeyFor(input.personId, input.evidence);
  return {
    id: recordIdFor(input.fingerprint, evidenceKey),
    kind: input.kind,
    fingerprint: input.fingerprint,
    personId: input.personId,
    evidenceKey,
    rubricHash: rubricHashOf(careerEvidenceSpecId(input.spec)),
  };
}

/**
 * The record, if it is the one that was asked for; a `TypeError` otherwise.
 *
 * The person is never part of a request — the claim state is the evidence
 * alone, and the identity state is a name and its identities — so the
 * fingerprint alone does not name an observation. The address is the record
 * id, which carries the evidence key as well, and what comes back is checked
 * against both: a store that answers with another person's record is a bug
 * here, not a cheap judgment.
 *
 * The rubric is checked for the same reason `deriveEvidence` checks it: the
 * assessment is read out of the record under a spec, so a record answering
 * different questions cannot be read here either, however well its shape
 * fits. Only the rubric hash is compared, not the version — a thresholds-only
 * bump asks the model exactly the same things — which neither widens nor
 * narrows what hits: the fingerprint already carries the whole spec id, so a
 * version bump misses before this is reached.
 */
export function assertRecordedFor(
  record: JevJudgmentRecord,
  expected: RecordExpectation,
): JevJudgmentRecord {
  if (
    record.id !== expected.id ||
    record.kind !== expected.kind ||
    record.requestFingerprint !== expected.fingerprint ||
    record.personId !== expected.personId ||
    record.evidenceKey !== expected.evidenceKey
  ) {
    throw new JudgmentInvariantError(
      `judgment store: ${expected.id} holds ${record.id}, a ${record.kind} record for ` +
        `${record.evidenceKey}; a store must return the record it was asked for`,
    );
  }
  const recordedRubric = rubricHashOf(record.specId);
  if (recordedRubric !== expected.rubricHash) {
    throw new JudgmentInvariantError(
      `judgment store: ${record.id} was judged under rubric ${recordedRubric} ` +
        `(${record.specId}), not ${expected.rubricHash}; an answer to a different question is ` +
        "not a cached judgment",
    );
  }
  return record;
}

/**
 * A stored record for this exact request *about this exact evidence*, or
 * `null`. Never a near miss: what the store hands back is checked by
 * `assertRecordedFor` before anything is read out of it.
 */
export async function recordedJudgment(
  store: JevJudgmentStore | undefined,
  expected: RecordExpectation,
): Promise<JevJudgmentRecord | null> {
  const record = (await store?.get(expected.id)) ?? null;
  return record === null ? null : assertRecordedFor(record, expected);
}

/**
 * Write the observation down, and take the store's word for it on a collision.
 *
 * Records are append-only, so a `put` that loses a race against another
 * worker's write of the *same* address throws rather than overwriting. That
 * is not a reason to fail the batch: the judgment at that address is already
 * recorded, and the recorded one is the observation — this run's answer to
 * the same question arrived second. It is read back, checked exactly as a
 * cache hit is, and used; a store that answers the re-read with someone
 * else's record, or with an answer to another rubric, is as loud here as it
 * is on the way in. A `put` that fails for any other reason (a misfiled
 * record, a store that is down) leaves nothing at the address and is
 * re-thrown.
 */
export async function recordJudgment(
  store: JevJudgmentStore | undefined,
  record: JevJudgmentRecord,
  expected: RecordExpectation,
): Promise<JevJudgmentRecord> {
  if (store === undefined) return record;
  try {
    await store.put(record);
    return record;
  } catch (error) {
    // `?? null` for the same reason the hit path has it: a store that answers
    // an empty address with `undefined` is answering "nothing is recorded
    // here", and the write failure is what the caller needs to hear about.
    const recorded = (await store.get(record.id)) ?? null;
    if (recorded === null) throw error;
    return assertRecordedFor(recorded, expected);
  }
}
