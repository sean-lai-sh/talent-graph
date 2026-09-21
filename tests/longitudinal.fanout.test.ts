/**
 * The bounded fan-out: concurrency, per-item isolation, and cancellation.
 *
 * `EvidenceRuntime` is fan-out shape, not transport policy. What is pinned
 * here is the cap on calls in flight, the output order regardless of
 * completion order, and that one item's failure is one item's failure — a
 * `review` claim that says the judgment was unavailable, never a zero.
 */

import { describe, expect, test } from "bun:test";
import type { CanonicalIdentity, JevJudgmentService } from "../src/index.ts";
import {
  DEFAULT_EVIDENCE_CONCURRENCY,
  DEFAULT_EVIDENCE_ITEM_ERROR,
  JudgmentInvariantError,
  processEvidence,
} from "../src/index.ts";
import type { EvidenceRuntime } from "../src/longitudinal/policy.ts";
import {
  failingClaim,
  failingIdentity,
  instrumented,
  runTenItems,
  tenItems,
} from "./helpers/fanout.ts";
import {
  acceptingJudgments,
  day,
  evidence,
  type FakeJudgments,
  identity,
  serviceOf,
} from "./helpers/longitudinal.ts";

describe("bounded judgment fan-out", () => {
  test("concurrency 2 keeps at most two judgment calls in flight and preserves order", async () => {
    const capped = instrumented();
    const unbounded = instrumented();
    const bounded = await runTenItems(capped.service, { concurrency: 2 });
    const wide = await runTenItems(unbounded.service, { concurrency: tenItems.length });
    expect(capped.peak()).toBe(2);
    expect(unbounded.peak()).toBe(tenItems.length);
    expect(bounded.claims).toEqual(wide.claims);
    expect(bounded.events).toEqual(wide.events);
    expect(bounded.snapshot).toEqual(wide.snapshot);
    expect(bounded.claims.map((claim) => claim.provenance.sourceId)).toEqual(
      tenItems.map((item) => item.sourceId),
    );
  });

  test("the default concurrency is four", async () => {
    const fake = instrumented();
    const result = await runTenItems(fake.service);
    expect(DEFAULT_EVIDENCE_CONCURRENCY).toBe(4);
    expect(fake.peak()).toBe(4);
    expect(result.claims).toHaveLength(tenItems.length);
  });

  test("concurrency must be an integer of at least one", async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(
        runTenItems(serviceOf(acceptingJudgments), { concurrency: bad }),
      ).rejects.toThrow(/integer >= 1/);
    }
  });
  test("one failing identity call rejects the batch only under onItemError: throw", async () => {
    await expect(
      runTenItems(serviceOf(failingIdentity), { concurrency: 2, onItemError: "throw" }),
    ).rejects.toThrow("jev identity 500");
  });

  test("one failing claim call rejects the batch only under onItemError: throw", async () => {
    await expect(
      runTenItems(serviceOf(failingClaim), { concurrency: 2, onItemError: "throw" }),
    ).rejects.toThrow("jev 500");
  });

  test("a failing claim isolates the item: nine claims plus one judgment_unavailable", async () => {
    const result = await runTenItems(serviceOf(failingClaim), { concurrency: 2 });
    expect(DEFAULT_EVIDENCE_ITEM_ERROR).toBe("review");
    expect(result.claims.map((claim) => claim.provenance.sourceId)).toEqual(
      tenItems.map((item) => item.sourceId),
    );
    const isolated = result.claims[7];
    expect(isolated?.provenance.sourceId).toBe("item-7");
    expect(isolated?.status).toBe("review");
    expect(isolated?.reviewReasons).toEqual(["judgment_unavailable"]);
    // Missing is not low: no assessment ran, so no kind and no event — never a
    // zero-score judgment standing in for one that was never made.
    expect(isolated?.assessedEventKind).toBe(null);
    // The identity judgment was paid for and is kept, exactly as observed.
    expect(isolated?.identityDecision).toBe("same");
    expect(isolated?.identityConfidence).toBe(0.98);
    expect(result.events.map((event) => event.evidenceClaimIds[0])).not.toContain(isolated?.id);
    expect(result.events).toHaveLength(tenItems.length - 1);
    expect(result.needsReview).toBe(true);
    // Nine items judged twice, the tenth's identity judgment kept.
    expect(result.records).toHaveLength((tenItems.length - 1) * 2 + 1);
    expect(result.claims.filter((claim) => claim.status === "accepted")).toHaveLength(
      tenItems.length - 1,
    );
  });

  test("a failing identity records the absence rather than a zero confidence", async () => {
    const result = await runTenItems(serviceOf(failingIdentity), { concurrency: 2 });
    const isolated = result.claims[7];
    expect(isolated?.provenance.sourceId).toBe("item-7");
    expect(isolated?.status).toBe("review");
    expect(isolated?.reviewReasons).toEqual(["judgment_unavailable"]);
    // No identity judgment was observed. `null` is that absence written down;
    // a `0` here would read as "certainly a different person".
    expect(isolated?.identityDecision).toBe(null);
    expect(isolated?.identityConfidence).toBe(null);
    expect(isolated?.assessedEventKind).toBe(null);
    expect(result.claims).toHaveLength(tenItems.length);
    expect(result.events).toHaveLength(tenItems.length - 1);
    // Nothing was observed for item-7, so it contributes no record.
    expect(result.records).toHaveLength((tenItems.length - 1) * 2);
  });

  /**
   * A service that hands the test a resolver per call instead of a timer:
   * nothing here races a clock, so the abort below lands at a known point.
   */
});

describe("a transport failure is not a broken invariant", () => {
  const runOver = (judgments: JevJudgmentService, runtime?: EvidenceRuntime) =>
    processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments,
      ...(runtime === undefined ? {} : { runtime }),
    });

  /** What `fetch` throws when a host cannot be reached: a plain `TypeError`. */
  const offline: FakeJudgments = {
    ...acceptingJudgments,
    async assessClaim() {
      throw new TypeError("fetch failed");
    },
  };

  test("a service that fails with a TypeError isolates the item", async () => {
    const result = await runOver(serviceOf(offline));
    expect(result.claims[0]?.status).toBe("review");
    expect(result.claims[0]?.reviewReasons).toEqual(["judgment_unavailable"]);
    // The identity judgment still happened, and is still the claim's.
    expect(result.claims[0]?.identityDecision).toBe("same");
  });

  test("the same failure still rejects the batch under onItemError: throw", async () => {
    await expect(runOver(serviceOf(offline), { onItemError: "throw" })).rejects.toThrow(
      "fetch failed",
    );
  });

  test("a broken record invariant is still loud, by class and not by shape", async () => {
    const honest = serviceOf(acceptingJudgments);
    const other: CanonicalIdentity = { ...identity, personId: "p-999" };
    const misaddressed: JevJudgmentService = {
      ...honest,
      assessIdentity: (_canonical, item, options) => honest.assessIdentity(other, item, options),
    };
    const rejection = runOver(misaddressed);
    await expect(rejection).rejects.toThrow(JudgmentInvariantError);
    await expect(rejection).rejects.toThrow(/must return the record it was asked for/);
    // Subclassing `TypeError` keeps every existing matcher true; the
    // isolation decision is the class, which a transport failure never has.
    await expect(rejection).rejects.toThrow(TypeError);
  });
});
