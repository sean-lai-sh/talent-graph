/**
 * The store: append-only, frozen, and paid for once.
 *
 * A record is deeply frozen when written and a second write of the same id
 * with different content throws rather than overwriting. A record filed
 * anywhere but its own address is refused outright. And a miss two askers hit
 * at once is one judgment, not two (#54 T7).
 */

import { describe, expect, test } from "bun:test";
import { createJevJudgmentService } from "../apps/club/lib/longitudinal/jev.ts";
import { processEvidence } from "../src/longitudinal/pipeline.ts";
import type { JevJudgmentRecord } from "../src/longitudinal/records.ts";
import { InMemoryJevJudgmentStore, type JevJudgmentStore } from "../src/longitudinal/store.ts";
import type { GrokEvidenceItem } from "../src/longitudinal/types.ts";
import { day, evidence, fakeClient, identity, isoDates, run, spec } from "./helpers/records.ts";

describe("judgment records: append-only and frozen", () => {
  test("a record is deeply frozen", async () => {
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec));
    const record = result.records[0] as JevJudgmentRecord;
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.answers)).toBe(true);
    expect(Object.isFrozen(record.usage)).toBe(true);
    expect(Object.isFrozen(record.answers.decision)).toBe(true);
    expect(() => {
      (record as { personId: string }).personId = "p-2";
    }).toThrow(TypeError);
    const claim = result.records[1] as JevJudgmentRecord;
    const difficulty = claim.answers.difficulty as { probabilities: number[]; legend: string[] };
    expect(Object.isFrozen(difficulty.probabilities)).toBe(true);
    expect(Object.isFrozen(difficulty.legend)).toBe(true);
    expect(() => {
      (difficulty.probabilities as number[])[0] = 1;
    }).toThrow(TypeError);
  });

  test("the observation time cannot be moved after the record is written", async () => {
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec));
    const record = result.records[0] as JevJudgmentRecord;
    const before = JSON.stringify(record);
    // A Date is mutable even inside a frozen object — `Object.isFrozen` is
    // true of it while `setTime` still moves the value — so the record keeps
    // the observation time as the ISO string a store would persist. There is
    // nothing left to mutate, and the assignment a holder could try throws.
    expect(typeof record.observedAt).toBe("string");
    expect(record.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    (record.observedAt as unknown as { setTime?: (value: number) => void }).setTime?.(0);
    expect(() => {
      (record as { observedAt: string }).observedAt = "1970-01-01T00:00:00.000Z";
    }).toThrow(TypeError);
    expect(JSON.stringify(record)).toBe(before);
  });

  test("a record whose id is not its own address is rejected on put", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec));
    const record = result.records[0] as JevJudgmentRecord;
    // The honest record writes and reads back.
    await store.put(record);
    expect(await store.get(record.id)).toEqual(record);
    // A record whose id does not derive from its own fingerprint and evidence
    // key would be written where nothing looks for it — a silent miss for
    // every later run. It is refused at the write, by name.
    const misfiled = { ...record, id: `jev-${record.requestFingerprint}` };
    await expect(store.put(misfiled)).rejects.toThrow(/misfiled/);
    await expect(store.put({ ...record, evidenceKey: "p-9|work|x|y" })).rejects.toThrow(/misfiled/);
    expect(await store.get(misfiled.id)).toBe(null);
  });

  test("a second put of the same fingerprint throws unless the content is identical", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec), store);
    const record = result.records[0] as JevJudgmentRecord;
    // Identical content is a no-op, not an error: a retried write is not a rewrite.
    await store.put(record);
    expect(await store.get(record.id)).toEqual(record);
    const rewritten = { ...record, respondedModel: "jev-2026-02" };
    await expect(store.put(rewritten)).rejects.toThrow(/already recorded/);
    expect((await store.get(record.id))?.respondedModel).toBe(record.respondedModel);
  });
});

describe("judgment records: a concurrent miss is paid for once (#54 T7)", () => {
  const duplicated = (id: string) => [evidence(id, 40), { ...evidence(id, 40) }];

  const runOver = (
    judgments: ReturnType<typeof createJevJudgmentService>,
    over: GrokEvidenceItem[],
    store: JevJudgmentStore,
  ) =>
    processEvidence({
      identity,
      evidence: over,
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments,
      spec,
      runtime: { store, concurrency: 4 },
    });

  test("two identical items in one batch issue one identity and one claim call", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const result = await runOver(
      createJevJudgmentService(client.client, spec),
      duplicated("work"),
      store,
    );
    // One question asked once, not twice — and the append-only store is never
    // handed a second write of the same observation.
    expect(client.calls()).toBe(2);
    expect(store.size).toBe(2);
    expect(result.claims).toHaveLength(2);
    expect(JSON.stringify(result.claims[0], isoDates)).toBe(
      JSON.stringify(result.claims[1], isoDates),
    );
    expect(new Set(result.records.map((record) => record.id)).size).toBe(2);
  });

  test("two concurrent runs over one store pay for one judgment each", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);
    const [left, right] = await Promise.all([
      runOver(service, [evidence("work", 40)], store),
      runOver(service, [evidence("work", 40)], store),
    ]);
    expect(client.calls()).toBe(2);
    expect(store.size).toBe(2);
    expect(JSON.stringify(left?.claims, isoDates)).toBe(JSON.stringify(right?.claims, isoDates));
  });

  test("a put that loses a race reads the recorded judgment back instead of failing", async () => {
    const honest = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const service = createJevJudgmentService(client.client, spec);
    // Pre-load the store with the records another worker already wrote, then
    // hide them from the first `get` of this run: the run misses, judges, and
    // its `put` collides with the record that was there all along.
    const seeded = await runOver(service, [evidence("work", 40)], honest);
    const recorded = new Map(seeded.records.map((record) => [record.id, record]));
    const hidden = new Set(recorded.keys());
    const racing: JevJudgmentStore = {
      async get(recordId) {
        if (hidden.delete(recordId)) return null;
        return honest.get(recordId);
      },
      async put(record) {
        // The append-only store refuses the second, different answer.
        await honest.put({ ...record, respondedModel: `${record.respondedModel}-other` });
      },
    };
    const raced = await runOver(service, [evidence("work", 40)], racing);
    // The recorded observation wins, and the batch does not fail.
    expect(raced.records.map((record) => record.id)).toEqual([...recorded.keys()]);
    expect(raced.records).toEqual(seeded.records);
    expect(JSON.stringify(raced.claims, isoDates)).toBe(JSON.stringify(seeded.claims, isoDates));
  });
});

describe("judgment records: the store answers a repeated run", () => {
  test("a second run over identical evidence issues zero SDK calls", async () => {
    const store = new InMemoryJevJudgmentStore();
    const first = fakeClient();
    const firstResult = await run(createJevJudgmentService(first.client, spec), store);
    expect(first.calls()).toBe(4); // two items, identity + claim each
    expect(firstResult.records).toHaveLength(4);

    const second = fakeClient();
    const secondResult = await run(createJevJudgmentService(second.client, spec), store);
    expect(second.calls()).toBe(0);
    expect(JSON.stringify(secondResult.claims, isoDates)).toBe(
      JSON.stringify(firstResult.claims, isoDates),
    );
    expect(JSON.stringify(secondResult.events, isoDates)).toBe(
      JSON.stringify(firstResult.events, isoDates),
    );
    expect(secondResult.records).toEqual(firstResult.records);
  });

  test("the records are the ones stored, in evaluation order", async () => {
    const store = new InMemoryJevJudgmentStore();
    const client = fakeClient();
    const result = await run(createJevJudgmentService(client.client, spec), store);
    expect(result.records.map((record) => record.kind)).toEqual([
      "identity",
      "claim",
      "identity",
      "claim",
    ]);
    // Evaluation order is the eligible order: oldest first.
    expect(result.records.map((record) => record.evidenceKey.split("|")[1])).toEqual([
      "work",
      "work",
      "more",
      "more",
    ]);
    for (const record of result.records) {
      expect(await store.get(record.id)).toEqual(record);
    }
  });
});
