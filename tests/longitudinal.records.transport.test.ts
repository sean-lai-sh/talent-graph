/**
 * The caller's signal reaches the transport, and a malformed answer is loud
 * (#54 T7).
 *
 * Cancellation is the only per-call transport option the pipeline sends, and a
 * run with no signal sends none of its own. A response that *arrived* and
 * cannot be read is not an unavailable judgment: it is corruption, no retry
 * fixes it, and it fails the batch by class even in the isolating mode.
 */

import { describe, expect, test } from "bun:test";
import type { Questions, SystemOneRequest, SystemOneResult, WithResponse } from "@typesafe-ai/sdk";
import type {
  JevClaimQuestions,
  JevClient,
  JevIdentityQuestions,
} from "../apps/club/lib/longitudinal/jev.ts";
import { createJevJudgmentService } from "../apps/club/lib/longitudinal/jev.ts";
import { processEvidence } from "../src/longitudinal/pipeline.ts";
import { JudgmentInvariantError } from "../src/longitudinal/records.ts";
import { InMemoryJevJudgmentStore, type JevJudgmentStore } from "../src/longitudinal/store.ts";
import { capturingClient, day, evidence, fakeClient, identity, spec } from "./helpers/records.ts";

describe("judgment records: the caller's signal reaches the transport (#54 T7)", () => {
  const runWithRuntime = (
    client: Parameters<typeof createJevJudgmentService>[0],
    signal?: AbortSignal,
  ) =>
    processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: createJevJudgmentService(client, spec),
      spec,
      ...(signal === undefined ? {} : { runtime: { signal } }),
    });

  test("a cancellable run puts every request under a signal of the pipeline's", async () => {
    const capturing = capturingClient();
    const controller = new AbortController();
    await runWithRuntime(capturing.client, controller.signal);
    const forwarded = capturing.signals();
    expect(forwarded).toHaveLength(2);
    // Not the caller's own signal. The request runs under the pipeline's, so
    // that a judgment several runs are waiting on is cancelled only when they
    // have all gone away; this run's abort still reaches it (asserted in
    // `tests/longitudinal.test.ts`).
    expect(forwarded.every((signal) => signal !== undefined && signal !== controller.signal)).toBe(
      true,
    );
    expect(forwarded.every((signal) => signal?.aborted === false)).toBe(true);
  });

  test("no signal means no signal: the adapter sends none of its own", async () => {
    const capturing = capturingClient();
    await runWithRuntime(capturing.client);
    expect(capturing.signals()).toEqual([undefined, undefined]);
  });
});

/**
 * A body with no usage at all.
 *
 * The SDK's type says `usage` is always there; a server can still answer
 * without it, which is exactly what the test below pins. Saying so needs one
 * assertion, and this is it — named, in one place, and not through `unknown`.
 */
function withoutUsage<Q extends Questions>(body: SystemOneResult<Q>): SystemOneResult<Q> {
  const { usage: _usage, ...rest } = body;
  return rest as SystemOneResult<Q>;
}

describe("judgment records: a malformed live answer is a broken invariant (#54 T7)", () => {
  /**
   * A client whose response body is corrupt in one named way. The transport
   * succeeded — this is an answer, it is just not one anything can read.
   *
   * Typed as a `JevClient` like every other double here, and built from a real
   * body rather than from scratch. The two corruptions are, deliberately,
   * bodies the SDK's types say cannot happen — that is the subject of these
   * tests — so each is stated at exactly one named point below and nowhere
   * else. Neither goes through `unknown`.
   */
  function corruptClient(corruption: "nan-probability" | "no-usage" | "transport"): {
    client: JevClient;
    calls: () => number;
  } {
    const inner = fakeClient();
    function systemOne(request: SystemOneRequest<JevIdentityQuestions>): {
      withResponse(): Promise<WithResponse<SystemOneResult<JevIdentityQuestions>>>;
    };
    function systemOne(request: SystemOneRequest<JevClaimQuestions>): {
      withResponse(): Promise<WithResponse<SystemOneResult<JevClaimQuestions>>>;
    };
    function systemOne(request: SystemOneRequest<Questions>): {
      withResponse(): Promise<WithResponse<SystemOneResult<Questions>>>;
    } {
      const isIdentity = "decision" in request.questions;
      return {
        async withResponse() {
          if (corruption === "transport") throw new Error("connect ECONNREFUSED");
          if (isIdentity) {
            const answered = await inner.client
              .systemOne(request as SystemOneRequest<JevIdentityQuestions>)
              .withResponse();
            // Only `no-usage` touches an identity body: there is no
            // `difficulty` answer in one to corrupt.
            return corruption === "no-usage"
              ? { ...answered, data: withoutUsage(answered.data) }
              : answered;
          }
          const answered = await inner.client
            .systemOne(request as SystemOneRequest<JevClaimQuestions>)
            .withResponse();
          if (corruption === "no-usage") {
            return { ...answered, data: withoutUsage(answered.data) };
          }
          const { difficulty } = answered.data.answers;
          return {
            ...answered,
            data: {
              ...answered.data,
              answers: {
                ...answered.data.answers,
                difficulty: {
                  ...difficulty,
                  probabilities: { ...difficulty.probabilities, 2: Number.NaN },
                },
              },
            },
          };
        },
      };
    }
    return { client: { systemOne }, calls: inner.calls };
  }

  const runOne = (client: JevClient, store: JevJudgmentStore) =>
    processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: createJevJudgmentService(client, spec),
      spec,
      // The isolating mode: a corrupt answer must still be loud here.
      runtime: { store, onItemError: "review" },
    });

  test("a probability that is not a number fails the batch by class", async () => {
    const store = new InMemoryJevJudgmentStore();
    const rejection = runOne(corruptClient("nan-probability").client, store);
    await expect(rejection).rejects.toThrow(JudgmentInvariantError);
    await expect(rejection).rejects.toThrow(/probabilities\[2\] must be a finite number/);
    // Nothing unreadable is recorded: the identity record of the same item is
    // written, the claim that could not be read is not.
    expect(store.values().map((record) => record.kind)).toEqual(["identity"]);
  });

  test("a response with no usage is unreadable, not unavailable", async () => {
    const store = new InMemoryJevJudgmentStore();
    const rejection = runOne(corruptClient("no-usage").client, store);
    await expect(rejection).rejects.toThrow(JudgmentInvariantError);
    await expect(rejection).rejects.toThrow(/usage\.input_tokens must be a finite number/);
    expect(store.size).toBe(0);
  });

  test("a transport failure from the same client still isolates the item", async () => {
    const store = new InMemoryJevJudgmentStore();
    const result = await runOne(corruptClient("transport").client, store);
    expect(result.claims[0]?.status).toBe("review");
    expect(result.claims[0]?.reviewReasons).toEqual(["judgment_unavailable"]);
    expect(result.claims[0]?.identityDecision).toBe(null);
    expect(store.size).toBe(0);
  });
});

/**
 * A live answer outside its range is refused where it arrives, not where it is
 * later read.
 *
 * `#81` made the projections reject a value the pipeline cannot represent. The
 * same rule has to hold one step earlier: a score of 4.5 or a confidence of
 * 1.0000001 that is written down and only explodes at projection is a judgment
 * that was paid for and cannot be used, and in a store it is a permanent one —
 * every later run reads it back and fails again. So the adapter range-checks
 * at parse time, before anything is put, and both sides share the guards in
 * `src/longitudinal/ranges.ts` so they cannot drift apart.
 */
describe("judgment records: a live answer is range-checked before it is stored", () => {
  const runWith = (client: JevClient, store?: InMemoryJevJudgmentStore) =>
    processEvidence({
      identity,
      evidence: [evidence("work", 40)],
      cutoffAt: day(90),
      retrievedAt: day(100),
      pipelineVersion: "1",
      judgments: createJevJudgmentService(client, spec),
      spec,
      // The isolating mode: an unreadable answer must still be loud here.
      runtime: { onItemError: "review", ...(store === undefined ? {} : { store }) },
    });

  test("a score past the rubric's top level is refused at the parse, by class", async () => {
    const store = new InMemoryJevJudgmentStore();
    const rejection = runWith(fakeClient({ score: 4.5 }).client, store);
    await expect(rejection).rejects.toThrow(JudgmentInvariantError);
    // `jev:` — the adapter, not `projectClaim:` several stages later.
    await expect(rejection).rejects.toThrow(/jev: difficulty\.score must be in \[0, 4\]/);
    // Nothing unreadable is recorded: the identity answer of the same item is
    // written, the claim that could not be read is not.
    expect(store.values().map((record) => record.kind)).toEqual(["identity"]);
  });

  test("a confidence just past one is refused too, not rounded down", async () => {
    const store = new InMemoryJevJudgmentStore();
    const rejection = runWith(fakeClient({ confidence: 1.0000001 }).client, store);
    await expect(rejection).rejects.toThrow(JudgmentInvariantError);
    await expect(rejection).rejects.toThrow(/jev: difficulty\.confidence must be in \[0, 1\]/);
    expect(store.values().map((record) => record.kind)).toEqual(["identity"]);
  });

  test("a score below zero is refused as well", async () => {
    await expect(runWith(fakeClient({ score: -0.5 }).client)).rejects.toThrow(
      /jev: difficulty\.score must be in \[0, 4\]/,
    );
  });

  test("the ends of every range still arrive and are stored", async () => {
    const store = new InMemoryJevJudgmentStore();
    const top = await runWith(fakeClient({ score: 4, confidence: 1 }).client, store);
    expect(top.claims[0]?.status).toBe("accepted");
    expect(store.values().map((record) => record.kind)).toEqual(["identity", "claim"]);

    const bottom = new InMemoryJevJudgmentStore();
    const zero = await runWith(fakeClient({ score: 0, confidence: 0 }).client, bottom);
    // Confidence 0 is below the gate, so the claim goes to review — but it
    // *arrived*: a legal value at the edge of the range is not a broken one.
    expect(zero.claims).toHaveLength(1);
    expect(bottom.values().map((record) => record.kind)).toEqual(["identity", "claim"]);
  });
});
