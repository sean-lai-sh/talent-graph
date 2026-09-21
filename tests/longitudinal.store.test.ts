/**
 * A judgment is addressed where it will be looked for, and checked on the way
 * back.
 *
 * A stale miss must not buy a judgment another asker already made; a record
 * for another person, or under another rubric, is refused by name rather than
 * turned into a cheap judgment or a plausible-looking review; and a `put` that
 * loses a race is re-read and checked exactly as a cache hit is.
 */

import { describe, expect, test } from "bun:test";
import type {
  CanonicalIdentity,
  JevJudgmentRecord,
  JevJudgmentService,
  JevJudgmentStore,
} from "../src/index.ts";
import { InMemoryJevJudgmentStore, processEvidence } from "../src/index.ts";
import type { EvidenceRuntime } from "../src/longitudinal/policy.ts";
import {
  acceptingJudgments,
  day,
  evidence,
  type FakeJudgments,
  flushTurns,
  identity,
  serviceOf,
} from "./helpers/longitudinal.ts";

describe("a store lookup that is overtaken", () => {
  test("a stale miss cannot buy a judgment another asker already made", async () => {
    const inner = new InMemoryJevJudgmentStore();
    let openLookup!: () => void;
    const held = new Promise<void>((resolve) => {
      openLookup = resolve;
    });
    let gated = true;
    // The first lookup of the run is answered late — after another asker has
    // judged, written and gone. Answering "nothing recorded" then is stale,
    // and paying for the judgment again is the cost of believing it.
    const overtaken: JevJudgmentStore = {
      async get(recordId) {
        if (gated) {
          gated = false;
          await held;
          return null;
        }
        return inner.get(recordId);
      },
      async put(record) {
        return inner.put(record);
      },
    };
    let identityCalls = 0;
    let claimCalls = 0;
    const counting: FakeJudgments = {
      async assessIdentity(canonical, item) {
        identityCalls += 1;
        return acceptingJudgments.assessIdentity(canonical, item);
      },
      async assessClaim(item) {
        claimCalls += 1;
        return acceptingJudgments.assessClaim(item);
      },
    };
    const service = serviceOf(counting);
    const once = () =>
      processEvidence({
        identity,
        evidence: [evidence("work", 40)],
        cutoffAt: day(90),
        retrievedAt: day(100),
        pipelineVersion: "1",
        judgments: service,
        runtime: { store: overtaken },
      });
    const first = once();
    await flushTurns();
    const second = once();
    await flushTurns();
    openLookup();
    const [left, right] = await Promise.all([first, second]);
    // One lookup and one judgment for the two runs: the lookup is part of the
    // work they share, so neither can be answered by a miss the other has
    // already overtaken.
    expect(identityCalls).toBe(1);
    expect(claimCalls).toBe(1);
    expect(inner.size).toBe(2);
    expect(left.records.map((record) => record.id)).toEqual(
      right.records.map((record) => record.id),
    );
    expect(left.claims[0]?.status).toBe("accepted");
    expect(right.claims[0]?.status).toBe("accepted");
  });
});

/**
 * A store that answers an empty address with `undefined` instead of `null`.
 *
 * `JevJudgmentStore.get` returns `JevJudgmentRecord | null`, so `undefined` is
 * a value the port cannot express — which is the whole subject of the test
 * below: the pipeline writes `?? null` on both read paths precisely because a
 * real store may do this anyway, and that guard has to be exercised. Saying it
 * in types takes one assertion, and this is it: named, in one place, and not
 * through `unknown`.
 */
function answersUndefined(): JevJudgmentStore {
  const store = {
    async get(): Promise<JevJudgmentRecord | undefined> {
      return undefined;
    },
    async put(): Promise<void> {
      throw new Error("append-only");
    },
  };
  return store as JevJudgmentStore;
}

describe("a judgment is addressed where it will be looked for", () => {
  /** A service that answers with a record about somebody else entirely. */
  const lying = (): JevJudgmentService => {
    const honest = serviceOf(acceptingJudgments);
    const other: CanonicalIdentity = { ...identity, personId: "p-999" };
    return {
      ...honest,
      assessIdentity: (_canonical, item, options) => honest.assessIdentity(other, item, options),
      assessClaim: (item, _personId, options) => honest.assessClaim(item, "p-999", options),
    };
  };

  const runOver = (judgments: JevJudgmentService, runtime: EvidenceRuntime) =>
    processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments,
      runtime,
    });

  test("a service's record for another person is refused, and nothing is written", async () => {
    const store = new InMemoryJevJudgmentStore();
    await expect(runOver(lying(), { store })).rejects.toThrow(
      /must return the record it was asked for/,
    );
    // Refused before the write: a record filed at an address nothing computes
    // is a permanent cache miss, and a re-billed judgment, not an error.
    expect(store.size).toBe(0);
  });

  test("a misaddressed record is a bug, not an unavailable judgment", async () => {
    // Per-item isolation is for a judgment that could not be made. This one
    // was made; it is about the wrong person.
    await expect(runOver(lying(), { onItemError: "review" })).rejects.toThrow(TypeError);
  });

  test("a store whose re-read answers with nothing surfaces the write failure", async () => {
    const result = await runOver(serviceOf(acceptingJudgments), { store: answersUndefined() });
    expect(result.claims[0]?.reviewReasons).toEqual(["judgment_unavailable"]);
  });
});

describe("a re-read after a losing put is checked like any other hit", () => {
  const runOver = (judgments: JevJudgmentService, store: JevJudgmentStore) =>
    processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments,
      runtime: { store },
    });

  /**
   * A store that misses on the address `instead` is filed at, refuses the
   * write, and then answers that address with `instead` — the shape of a race
   * lost to another worker. Every other address stays empty.
   */
  const losingStore = (instead: JevJudgmentRecord): JevJudgmentStore => {
    let missed = false;
    return {
      async get(recordId) {
        if (recordId !== instead.id) return null;
        if (!missed) {
          missed = true;
          return null;
        }
        return instead;
      },
      async put() {
        throw new Error("append-only");
      },
    };
  };

  test("a re-read under a foreign rubric is refused by name, not turned into a review", async () => {
    const service = serviceOf(acceptingJudgments);
    const honest = new InMemoryJevJudgmentStore();
    const seeded = await runOver(service, honest);
    const record = seeded.records[0] as JevJudgmentRecord;
    const foreign = { ...record, specId: "career_evidence@9.9.9:0123456789abcdef" };
    await expect(runOver(service, losingStore(foreign))).rejects.toThrow(/different question/);
  });

  test("a re-read of another person's record is refused by name", async () => {
    const service = serviceOf(acceptingJudgments);
    const honest = new InMemoryJevJudgmentStore();
    const seeded = await runOver(service, honest);
    const record = seeded.records[0] as JevJudgmentRecord;
    const someoneElse = {
      ...record,
      personId: "p-999",
      evidenceKey: `p-999|${record.evidenceKey}`,
    };
    await expect(runOver(service, losingStore(someoneElse))).rejects.toThrow(
      /must return the record it was asked for/,
    );
  });

  test("a put that fails with nothing at the address is still the item's failure", async () => {
    const service = serviceOf(acceptingJudgments);
    const empty: JevJudgmentStore = {
      async get() {
        return null;
      },
      async put() {
        throw new Error("store is down");
      },
    };
    const result = await runOver(service, empty);
    expect(result.claims[0]?.reviewReasons).toEqual(["judgment_unavailable"]);
    expect(result.claims[0]?.identityDecision).toBe(null);
  });
});
