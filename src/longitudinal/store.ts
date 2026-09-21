/**
 * Where judgment records are kept.
 *
 * The append-only rule lives here: a record is frozen when it is written, and
 * a second write of the same id with different content is an error, not an
 * update. The record's shape and its address are `./records.ts`; this module
 * only holds them.
 *
 * Pure and runtime-agnostic: no SDK, no fetch, no clock.
 */

import { deepFreeze } from "../models/freeze.ts";
import type { JevJudgmentRecord } from "./records.ts";
import { JudgmentInvariantError, recordContent, recordIdFor } from "./records.ts";

/**
 * Where judgment records are kept. The in-memory implementation below is the
 * reference; a durable one has the same two methods and the same append-only
 * rule.
 *
 * A record is addressed by its **id**, which carries both the request
 * fingerprint and the evidence key (`recordIdFor`). Addressing by fingerprint
 * alone would serve one person's observation to another, because the person is
 * not part of the request that was sent.
 */
export interface JevJudgmentStore {
  get(recordId: string): Promise<JevJudgmentRecord | null>;
  put(record: JevJudgmentRecord): Promise<void>;
}

/**
 * Freeze a record deeply. Nothing inside it can move afterwards: every value
 * it carries is a string, a number or a frozen array or object, so there is no
 * `Date` (or other mutable box) for a holder to reach through.
 */
export function freezeRecord(record: JevJudgmentRecord): JevJudgmentRecord {
  if (typeof record.observedAt !== "string" || Number.isNaN(Date.parse(record.observedAt))) {
    throw new JudgmentInvariantError(
      `freezeRecord: observedAt must be an ISO 8601 instant (got ${String(record.observedAt)})`,
    );
  }
  return deepFreeze({ ...record });
}

/**
 * The reference store: a `Map` addressed by record id, an append-only `put`,
 * and frozen records.
 *
 * A second `put` of the same id with identical content is a no-op — a retried
 * write is not a rewrite — and with different content it throws, so a record
 * can never be silently replaced by a later, different answer. A record whose
 * id is not its own address is refused outright: written under any other key
 * it would be a record nothing can find.
 */
export class InMemoryJevJudgmentStore implements JevJudgmentStore {
  readonly #records = new Map<string, JevJudgmentRecord>();

  async get(recordId: string): Promise<JevJudgmentRecord | null> {
    return this.#records.get(recordId) ?? null;
  }

  async put(record: JevJudgmentRecord): Promise<void> {
    assertRecordAddress(record);
    const frozen = freezeRecord(record);
    const existing = this.#records.get(frozen.id);
    if (existing !== undefined) {
      if (recordContent(existing) === recordContent(frozen)) return;
      throw new Error(
        `JevJudgmentStore: ${frozen.id} is already recorded with different content; ` +
          "judgment records are append-only",
      );
    }
    this.#records.set(frozen.id, frozen);
  }

  /** Every record held, in insertion order. For inspection and tests. */
  values(): JevJudgmentRecord[] {
    return [...this.#records.values()];
  }

  get size(): number {
    return this.#records.size;
  }
}

/**
 * A record must be stored where a later run will look for it.
 *
 * Every store write goes through here: an id that is not
 * `recordIdFor(requestFingerprint, evidenceKey)` is a record filed under an
 * address nothing computes, which reads back as a permanent cache miss and a
 * re-billed judgment rather than as an error. Loud at the write instead.
 */
export function assertRecordAddress(record: JevJudgmentRecord): void {
  const address = recordIdFor(record.requestFingerprint, record.evidenceKey);
  if (record.id !== address) {
    throw new JudgmentInvariantError(
      `JevJudgmentStore: record ${record.id} is misfiled; its request fingerprint and evidence ` +
        `key address ${address}`,
    );
  }
}
