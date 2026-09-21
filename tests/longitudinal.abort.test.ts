/**
 * Cancellation, and what a run already paid for keeps.
 *
 * An abort rejects the whole call whatever `onItemError` says: a cancelled
 * batch has no partial result to report. It cancels *claims*, not
 * observations — a judgment already made is still written down, because it was
 * paid for and throwing it away would only mean buying it again — so a retry
 * after a cancelled or partly failed run starts from a store hit and re-judges
 * exactly what is missing.
 */

import { describe, expect, test } from "bun:test";
import type { JevJudgmentService } from "../src/index.ts";
import { InMemoryJevJudgmentStore, processEvidence } from "../src/index.ts";
import { failingClaim, runTenItems, tenItems } from "./helpers/fanout.ts";
import {
  acceptingJudgments,
  day,
  evidence,
  type FakeJudgments,
  identity,
  serviceOf,
} from "./helpers/longitudinal.ts";

describe("cancellation and what survives it", () => {
  function gated(): {
    service: JevJudgmentService;
    started: () => string[];
    release: () => void;
    signals: () => (AbortSignal | undefined)[];
    whenStarted: (count: number) => Promise<void>;
  } {
    const started: string[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const held: Array<() => void> = [];
    const waiters: Array<{ count: number; resolve: () => void }> = [];
    const hold = async (sourceId: string, signal: AbortSignal | undefined) => {
      started.push(sourceId);
      signals.push(signal);
      for (const waiter of waiters.splice(0)) {
        if (waiter.count <= started.length) waiter.resolve();
        else waiters.push(waiter);
      }
      await new Promise<void>((resolve) => held.push(resolve));
      signal?.throwIfAborted();
    };
    const service: JevJudgmentService = {
      ...serviceOf(acceptingJudgments),
      async assessIdentity(canonical, item, options) {
        await hold(item.sourceId, options?.signal);
        return serviceOf(acceptingJudgments).assessIdentity(canonical, item);
      },
    };
    return {
      service,
      started: () => [...started],
      signals: () => [...signals],
      release: () => {
        for (const resolve of held.splice(0)) resolve();
      },
      whenStarted: (count) =>
        started.length >= count
          ? Promise.resolve()
          : new Promise<void>((resolve) => waiters.push({ count, resolve })),
    };
  }

  test("an aborted signal cancels in-flight work and leaves no partial claim", async () => {
    const controller = new AbortController();
    const fake = gated();
    const pending = runTenItems(fake.service, { concurrency: 2, signal: controller.signal });
    // Deterministic: the two in-flight calls are held open until released, so
    // the abort below happens with exactly the cap in flight. Nothing waits on
    // a clock.
    await fake.whenStarted(2);
    expect(fake.started()).toEqual(["item-0", "item-1"]);
    // The requests run under the pipeline's own signal, not the caller's, so
    // a judgment shared with another run is not cancelled by one asker
    // leaving; with this run the only asker, the caller's abort reaches it.
    const forwarded = fake.signals();
    expect(forwarded.every((signal) => signal !== undefined && signal !== controller.signal)).toBe(
      true,
    );
    expect(forwarded.every((signal) => signal?.aborted === false)).toBe(true);
    controller.abort(new Error("caller went away"));
    expect(forwarded.every((signal) => signal?.aborted === true)).toBe(true);
    fake.release();
    await expect(pending).rejects.toThrow("caller went away");
    // No item past the cap was ever started: the pool stopped handing out work.
    expect(fake.started()).toEqual(["item-0", "item-1"]);
  });

  test("a signal already aborted judges nothing at all", async () => {
    const fake = gated();
    await expect(
      runTenItems(fake.service, { concurrency: 2, signal: AbortSignal.abort(new Error("gone")) }),
    ).rejects.toThrow("gone");
    expect(fake.started()).toEqual([]);
  });

  test("a retry after a partial failure re-judges only the failed item", async () => {
    const store = new InMemoryJevJudgmentStore();
    let firstCalls = 0;
    const counting = (fake: FakeJudgments): FakeJudgments => ({
      async assessIdentity(canonical, item) {
        firstCalls += 1;
        return fake.assessIdentity(canonical, item);
      },
      async assessClaim(item) {
        firstCalls += 1;
        return fake.assessClaim(item);
      },
    });
    const partial = await runTenItems(serviceOf(counting(failingClaim)), { concurrency: 2, store });
    expect(partial.claims[7]?.reviewReasons).toEqual(["judgment_unavailable"]);
    // Ten identity calls and nine claim calls; the tenth claim threw.
    expect(firstCalls).toBe(tenItems.length * 2);
    expect(store.size).toBe(tenItems.length * 2 - 1);

    firstCalls = 0;
    const retry = await runTenItems(serviceOf(counting(acceptingJudgments)), {
      concurrency: 2,
      store,
    });
    // Exactly one judgment re-made: the claim that failed. Everything else is
    // a store hit.
    expect(firstCalls).toBe(1);
    expect(retry.claims.map((claim) => claim.status)).toEqual(tenItems.map(() => "accepted"));
    expect(retry.needsReview).toBe(false);
    expect(store.size).toBe(tenItems.length * 2);
  });

  test("duplicate items in one batch are judged once and both claims derive from it", async () => {
    const store = new InMemoryJevJudgmentStore();
    let calls = 0;
    const counting: FakeJudgments = {
      async assessIdentity(canonical, item) {
        calls += 1;
        return acceptingJudgments.assessIdentity(canonical, item);
      },
      async assessClaim(item) {
        calls += 1;
        return acceptingJudgments.assessClaim(item);
      },
    };
    const duplicated = evidence("dup", 40);
    const result = await processEvidence({
      identity,
      evidence: [duplicated, { ...duplicated }],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: serviceOf(counting),
      runtime: { concurrency: 2, store },
    });
    // One identity call and one claim call for the two identical items, and
    // one record each: the second `put` of an append-only store never runs.
    expect(calls).toBe(2);
    expect(store.size).toBe(2);
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0]).toEqual(result.claims[1]);
    const ids = result.records.map((record) => record.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(2);
    expect(ids.slice(0, 2)).toEqual(ids.slice(2));
  });

  test("two concurrent runs sharing a store pay for one judgment each", async () => {
    const store = new InMemoryJevJudgmentStore();
    let calls = 0;
    const counting: FakeJudgments = {
      async assessIdentity(canonical, item) {
        calls += 1;
        return acceptingJudgments.assessIdentity(canonical, item);
      },
      async assessClaim(item) {
        calls += 1;
        return acceptingJudgments.assessClaim(item);
      },
    };
    const service = serviceOf(counting);
    const once = () =>
      processEvidence({
        identity,
        evidence: [evidence("shared", 40)],
        cutoffAt: day(90),
        retrievedAt: day(100),
        pipelineVersion: "1",
        judgments: service,
        runtime: { store },
      });
    const [left, right] = await Promise.all([once(), once()]);
    expect(calls).toBe(2);
    expect(store.size).toBe(2);
    expect(left?.claims[0]).toEqual(right?.claims[0]);
  });
});
