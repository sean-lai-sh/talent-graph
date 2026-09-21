/**
 * A judgment record is addressed by the request *and* the evidence, and read
 * only under the rubric it answered.
 *
 * The person is never part of a request, so a cache addressed by fingerprint
 * alone would hand one person's judgment to another. And a record whose rubric
 * hash differs answers a different question: it is refused by name, both on
 * the way out of a store and on the way into a derivation.
 */

import { describe, expect, test } from "bun:test";
import { createJevJudgmentService } from "../apps/club/lib/longitudinal/jev.ts";
import { processEvidence } from "../src/longitudinal/pipeline.ts";
import type { JevJudgmentRecord } from "../src/longitudinal/records.ts";
import { InMemoryJevJudgmentStore, type JevJudgmentStore } from "../src/longitudinal/store.ts";
import type { CanonicalIdentity } from "../src/longitudinal/types.ts";
import { careerEvidenceSpecId } from "../src/models/careerEvidence.ts";
import { day, fakeClient, identity, isoDates, items, STRICTER, spec } from "./helpers/records.ts";

describe("judgment records: a cache hit belongs to the evidence it was asked about", () => {
  /** The same person, name and evidence bytes — only the person id differs. */
  const other: CanonicalIdentity = { ...identity, personId: "p-2" };

  const runFor = (
    who: CanonicalIdentity,
    judgments: ReturnType<typeof createJevJudgmentService>,
    store: InMemoryJevJudgmentStore,
  ) =>
    processEvidence({
      identity: who,
      evidence: items,
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments,
      spec,
      runtime: { store },
    });

  test("two people with identical evidence never share a judgment record", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);

    const first = await runFor(identity, service, store);
    expect(client.calls()).toBe(4);
    // The request is byte-identical for the second person — the person id is
    // never sent — so only the record's evidence key keeps the two apart.
    const second = await runFor(other, service, store);
    expect(client.calls()).toBe(8);
    const again = await runFor(identity, service, store);
    expect(client.calls()).toBe(8);

    for (const record of first.records) {
      expect(record.personId).toBe("p-1");
      expect(record.evidenceKey.startsWith("p-1|")).toBe(true);
    }
    for (const record of second.records) {
      expect(record.personId).toBe("p-2");
      expect(record.evidenceKey.startsWith("p-2|")).toBe(true);
    }
    expect(new Set(second.records.map((record) => record.id)).size).toBe(4);
    expect(
      first.records.some((record) => second.records.some((other) => other.id === record.id)),
    ).toBe(false);
    expect(again.records).toEqual(first.records);

    // That each person's records then derive on their own — a record addressed
    // only by request fingerprint would have handed the second person the
    // first person's observation — is pinned in
    // tests/longitudinal.records.test.ts, where the derivation lives.
  });

  test("a stored record for other evidence is never served for this request", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);
    const result = await runFor(identity, service, store);
    const record = result.records[0] as JevJudgmentRecord;
    // The address is the record's id, which carries both the request
    // fingerprint and the evidence key; the fingerprint alone addresses
    // nothing.
    expect(await store.get(record.id)).toEqual(record);
    expect(await store.get(record.requestFingerprint)).toBe(null);
  });
});

describe("judgment records: a cache hit must carry the rubric it is read under", () => {
  /** A store that answers with a record stamped under someone else's rubric. */
  function restampingStore(honest: InMemoryJevJudgmentStore, specId: string): JevJudgmentStore {
    return {
      async get(recordId) {
        const record = await honest.get(recordId);
        return record === null ? null : { ...record, specId };
      },
      async put(record) {
        await honest.put(record);
      },
    };
  }

  const runWith = (
    store: JevJudgmentStore,
    judgments: ReturnType<typeof createJevJudgmentService>,
  ) =>
    processEvidence({
      identity,
      evidence: items,
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments,
      spec,
      runtime: { store },
    });

  test("a record at the right address but under a foreign rubric is rejected by name", async () => {
    const honest = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);
    await runWith(honest, service);
    expect(client.calls()).toBe(4);

    // Everything the address check looks at is right; only the rubric the
    // record answers is another one. Reading it under this spec would be
    // reading an answer to a different question.
    const foreign = restampingStore(honest, "career_evidence@1.0.0:deadbeef");
    await expect(runWith(foreign, service)).rejects.toThrow(/deadbeef/);
  });

  test("the honest record is still served, and a thresholds-only rubric match stays a hit", async () => {
    const honest = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);
    const first = await runWith(honest, service);
    expect(client.calls()).toBe(4);
    // Same rubric hash, restamped with the version a thresholds-only bump
    // carries: still the same questions, so still a hit and no new call.
    const bumped = restampingStore(honest, careerEvidenceSpecId(STRICTER));
    const second = await runWith(bumped, service);
    expect(client.calls()).toBe(4);
    expect(JSON.stringify(second.claims, isoDates)).toBe(JSON.stringify(first.claims, isoDates));
  });
});
