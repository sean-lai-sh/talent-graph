/**
 * A coalesced judgment belongs to every asker — and so does its absence.
 *
 * Askers share the request, not each other's cancellation: one caller going
 * away is not an answer about anyone else's batch. A failure that is not a
 * cancellation is shared, and each asker isolates it under its own
 * `onItemError`. A transport failure is never a broken invariant.
 */

import { describe, expect, test } from "bun:test";
import type { JevJudgmentService, JevJudgmentStore } from "../src/index.ts";
import { InMemoryJevJudgmentStore, processEvidence } from "../src/index.ts";
import type { EvidenceRuntime } from "../src/longitudinal/policy.ts";
import {
  acceptingJudgments,
  day,
  evidence,
  type FakeJudgments,
  identity,
  serviceOf,
} from "./helpers/longitudinal.ts";

describe("a coalesced judgment belongs to every asker", () => {
  /**
   * A service whose identity call is held open until the test releases it, so
   * a second run can join the first one's in-flight judgment at a known point.
   * No timers: the hold is a promise the test resolves.
   */
  function holding(): {
    service: JevJudgmentService;
    identityCalls: () => number;
    claimCalls: () => number;
    signals: () => (AbortSignal | undefined)[];
    started: () => number;
    release: () => void;
  } {
    let identityCalls = 0;
    let claimCalls = 0;
    const signals: (AbortSignal | undefined)[] = [];
    const held: Array<() => void> = [];
    const inner = serviceOf(acceptingJudgments);
    return {
      identityCalls: () => identityCalls,
      claimCalls: () => claimCalls,
      signals: () => [...signals],
      started: () => signals.length,
      release: () => {
        for (const resolve of held.splice(0)) resolve();
      },
      service: {
        ...inner,
        async assessIdentity(canonical, item, options) {
          identityCalls += 1;
          signals.push(options?.signal);
          await new Promise<void>((resolve) => held.push(resolve));
          options?.signal?.throwIfAborted();
          return inner.assessIdentity(canonical, item, options);
        },
        async assessClaim(item, personId, options) {
          claimCalls += 1;
          return inner.assessClaim(item, personId, options);
        },
      },
    };
  }

  /** Drain the microtask queue. Deterministic: nothing here waits on a clock. */
  const flush = async (turns = 50) => {
    for (let turn = 0; turn < turns; turn++) await Promise.resolve();
  };

  const runOne = (judgments: JevJudgmentService, runtime: EvidenceRuntime) =>
    processEvidence({
      identity,
      evidence: [evidence("shared", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments,
      runtime,
    });

  test("one asker's abort leaves the other asker's claim intact", async () => {
    const store = new InMemoryJevJudgmentStore();
    const gate = holding();
    const controller = new AbortController();
    const cancelled = runOne(gate.service, { store, signal: controller.signal });
    await flush();
    const bystander = runOne(gate.service, { store });
    await flush();
    expect(gate.identityCalls()).toBe(1);
    controller.abort(new Error("A went away"));
    gate.release();
    const [aborted, kept] = await Promise.allSettled([cancelled, bystander]);

    expect(aborted.status).toBe("rejected");
    expect(String(aborted.status === "rejected" ? aborted.reason : "")).toContain("A went away");
    // The judgment the aborted run started is still owed to the run that
    // joined it: one call, a real claim, and nothing inherited from a
    // cancellation that was never this run's.
    expect(kept.status).toBe("fulfilled");
    const claim = kept.status === "fulfilled" ? kept.value.claims[0] : undefined;
    expect(claim?.status).toBe("accepted");
    expect(claim?.identityDecision).toBe("same");
    expect(claim?.reviewReasons).toBeUndefined();
    expect(gate.identityCalls()).toBe(1);
    expect(store.size).toBe(2);
  });

  test("an abort cannot reject an asker that never asked to be cancelled", async () => {
    const store = new InMemoryJevJudgmentStore();
    const gate = holding();
    const controller = new AbortController();
    const cancelled = runOne(gate.service, { store, signal: controller.signal });
    await flush();
    const strict = runOne(gate.service, { store, onItemError: "throw" });
    await flush();
    controller.abort(new Error("A went away"));
    gate.release();
    const [, kept] = await Promise.allSettled([cancelled, strict]);
    // Under `throw` an inherited abort would have rejected the whole batch.
    expect(kept.status).toBe("fulfilled");
    expect(kept.status === "fulfilled" ? kept.value.claims[0]?.status : undefined).toBe("accepted");
  });

  test("the shared judgment is cancelled once every asker has aborted", async () => {
    const store = new InMemoryJevJudgmentStore();
    const gate = holding();
    const first = new AbortController();
    const second = new AbortController();
    const one = runOne(gate.service, { store, signal: first.signal });
    await flush();
    const two = runOne(gate.service, { store, signal: second.signal });
    await flush();
    expect(gate.identityCalls()).toBe(1);
    first.abort(new Error("one gone"));
    await flush();
    // One asker left: the request the other two share is still wanted.
    expect(gate.signals()[0]?.aborted).toBe(false);
    second.abort(new Error("two gone"));
    await flush();
    expect(gate.signals()[0]?.aborted).toBe(true);
    gate.release();
    const [a, b] = await Promise.allSettled([one, two]);
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("rejected");
    // Nothing was observed, so nothing was written.
    expect(store.size).toBe(0);
  });

  test("a judgment the aborted starter began is still there for a later asker", async () => {
    const store = new InMemoryJevJudgmentStore();
    const gate = holding();
    const controller = new AbortController();
    const starter = runOne(gate.service, { store, signal: controller.signal });
    await flush();
    const waiting = runOne(gate.service, { store });
    await flush();
    controller.abort(new Error("starter gone"));
    await flush();
    // The starter has left, but the judgment it began is still owed to the
    // run that joined it — so a third asker joins that one rather than
    // buying the same answer again.
    const latecomer = runOne(gate.service, { store });
    await flush();
    expect(gate.identityCalls()).toBe(1);
    gate.release();
    const [gone, kept, joined] = await Promise.allSettled([starter, waiting, latecomer]);
    expect(gone.status).toBe("rejected");
    expect(kept.status).toBe("fulfilled");
    expect(joined.status).toBe("fulfilled");
    expect(joined.status === "fulfilled" ? joined.value.claims[0]?.status : undefined).toBe(
      "accepted",
    );
    expect(gate.identityCalls()).toBe(1);
    expect(store.size).toBe(2);
  });

  test("an abort that lands during the store read buys nothing at all", async () => {
    const inner = new InMemoryJevJudgmentStore();
    let openGet!: () => void;
    const held = new Promise<void>((resolve) => {
      openGet = resolve;
    });
    const slow: JevJudgmentStore = {
      async get(recordId) {
        await held;
        return inner.get(recordId);
      },
      async put(record) {
        return inner.put(record);
      },
    };
    const gate = holding();
    const controller = new AbortController();
    const pending = runOne(gate.service, { store: slow, signal: controller.signal });
    await flush();
    // The caller goes away while the store lookup is still in flight: the
    // pool's own check has already passed, so the guard has to be here too.
    controller.abort(new Error("caller gone"));
    openGet();
    await expect(pending).rejects.toThrow("caller gone");
    await flush();
    expect(gate.identityCalls()).toBe(0);
    expect(inner.size).toBe(0);
  });

  test("a judgment that fails for any other reason fails for every asker", async () => {
    // Deliberate and documented: askers share the observation, so they share
    // its absence too. Each one then isolates it under its own `onItemError`.
    const store = new InMemoryJevJudgmentStore();
    let claimCalls = 0;
    const failing: FakeJudgments = {
      ...acceptingJudgments,
      async assessClaim() {
        claimCalls += 1;
        throw new Error("jev 500");
      },
    };
    const service = serviceOf(failing);
    const [lenient, strict] = await Promise.allSettled([
      runOne(service, { store }),
      runOne(service, { store, onItemError: "throw" }),
    ]);
    expect(claimCalls).toBe(1);
    expect(lenient.status).toBe("fulfilled");
    expect(
      lenient.status === "fulfilled" ? lenient.value.claims[0]?.reviewReasons : undefined,
    ).toEqual(["judgment_unavailable"]);
    expect(strict.status).toBe("rejected");
  });
});
