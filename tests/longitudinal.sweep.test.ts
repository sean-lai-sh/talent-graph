/**
 * What a sweep does with a bad item, and when it gives up.
 *
 * A sweep is the monitoring plan and the pipeline meeting: an isolated item
 * routes its plan to review rather than to failed, the runtime the sweep is
 * given reaches the pipeline, and the attempt cap terminalizes a plan instead
 * of looping on it forever.
 */

import { describe, expect, test } from "bun:test";
import {
  batchDueMonitoringPlans,
  createMonitoringPlan,
  DEFAULT_MAX_MONITORING_ATTEMPTS,
  DEFAULT_MONITORING_LEASE_MS,
  failMonitoringPlan,
  InMemoryJevJudgmentStore,
  MAX_MONITORING_ATTEMPTS_ERROR,
  runDueMonitoringPlans,
  startMonitoringPlan,
} from "../src/index.ts";
import {
  acceptingJudgments,
  day,
  evidence,
  type FakeJudgments,
  identity,
  serviceOf,
} from "./helpers/longitudinal.ts";

describe("a sweep survives one bad item", () => {
  test("an isolated item routes the plan to review, never to failed", async () => {
    const failing: FakeJudgments = {
      ...acceptingJudgments,
      async assessClaim(item) {
        if (item.sourceId === "bad") throw new Error("jev 500");
        return acceptingJudgments.assessClaim(item);
      },
    };
    const run = await runDueMonitoringPlans({
      plans: [
        createMonitoringPlan({
          id: "sweep",
          personId: "p-1",
          caseId: "c-1",
          caseOpenedAt: day(0),
          horizonDays: 90,
          pipelineVersion: "1",
        }),
      ],
      identities: new Map([["p-1", identity]]),
      now: day(200),
      collector: {
        async collect() {
          return [evidence("good", 40), evidence("bad", 50)];
        },
      },
      judgments: serviceOf(failing),
    });
    // One item could not be judged; the sweep is not a failure, and the plan
    // keeps its single attempt rather than being retried into the cap.
    expect(run.plans[0]?.status).toBe("review");
    expect(run.plans[0]?.error).toBe(null);
    expect(run.plans[0]?.attemptCount).toBe(1);
    const claims = run.results[0]?.result.claims ?? [];
    expect(claims.map((claim) => claim.status)).toEqual(["accepted", "review"]);
    expect(claims[1]?.reviewReasons).toEqual(["judgment_unavailable"]);
    expect(run.results[0]?.result.events).toHaveLength(1);
  });

  test("the runtime the sweep is given reaches the pipeline", async () => {
    const store = new InMemoryJevJudgmentStore();
    let calls = 0;
    const counted: FakeJudgments = {
      async assessIdentity(canonical, item) {
        calls += 1;
        return acceptingJudgments.assessIdentity(canonical, item);
      },
      async assessClaim(item) {
        calls += 1;
        return acceptingJudgments.assessClaim(item);
      },
    };
    const sweep = () =>
      runDueMonitoringPlans({
        plans: [
          createMonitoringPlan({
            id: "sweep",
            personId: "p-1",
            caseId: "c-1",
            caseOpenedAt: day(0),
            horizonDays: 90,
            pipelineVersion: "1",
          }),
        ],
        identities: new Map([["p-1", identity]]),
        now: day(200),
        collector: {
          async collect() {
            return [evidence("good", 40)];
          },
        },
        judgments: serviceOf(counted),
        runtime: { concurrency: 1, store },
      });
    await sweep();
    expect(calls).toBe(2);
    await sweep();
    expect(calls).toBe(2);
    expect(store.size).toBe(2);
  });
});

describe("monitoring attempt cap", () => {
  const plan = () =>
    createMonitoringPlan({
      id: "capped",
      personId: "p-1",
      caseId: "c-1",
      caseOpenedAt: day(0),
      horizonDays: 90,
      pipelineVersion: "1",
    });

  const burnAttempts = (count: number) => {
    let current = plan();
    for (let attempt = 0; attempt < count; attempt++) {
      current = failMonitoringPlan(
        startMonitoringPlan(current, day(100 + attempt)),
        "github 503",
        day(100 + attempt),
      );
    }
    return current;
  };

  test("a plan below the cap is still readmitted and retried", () => {
    const belowCap = burnAttempts(DEFAULT_MAX_MONITORING_ATTEMPTS - 1);
    expect(belowCap.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS - 1);
    expect(batchDueMonitoringPlans([belowCap], day(200))).toHaveLength(1);
    expect(startMonitoringPlan(belowCap, day(200)).status).toBe("running");
  });

  test("a plan at the cap is not readmitted and never runs again", async () => {
    const exhausted = burnAttempts(DEFAULT_MAX_MONITORING_ATTEMPTS);
    expect(exhausted.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS);
    expect(batchDueMonitoringPlans([exhausted], day(200))).toEqual([]);
    // Already failed: it keeps the error that spent its last attempt.
    expect(startMonitoringPlan(exhausted, day(200))).toEqual(exhausted);
    expect(exhausted.status).toBe("failed");

    let fetches = 0;
    const sweep = await runDueMonitoringPlans({
      plans: [exhausted],
      identities: new Map([["p-1", identity]]),
      now: day(200),
      collector: {
        async collect() {
          fetches++;
          return [evidence("recovered", 40)];
        },
      },
      judgments: serviceOf(acceptingJudgments),
    });
    expect(fetches).toBe(0);
    expect(sweep.plans[0]).toEqual(exhausted);
    expect(sweep.results).toEqual([]);
  });

  test("a stale running lease at the cap settles as failed instead of looping", () => {
    let current = plan();
    for (let attempt = 0; attempt < DEFAULT_MAX_MONITORING_ATTEMPTS - 1; attempt++) {
      current = failMonitoringPlan(
        startMonitoringPlan(current, day(100 + attempt)),
        "github 503",
        day(100 + attempt),
      );
    }
    const stranded = startMonitoringPlan(current, day(150));
    expect(stranded.status).toBe("running");
    expect(stranded.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS);
    const afterLease = new Date(day(150).getTime() + DEFAULT_MONITORING_LEASE_MS);
    expect(batchDueMonitoringPlans([stranded], afterLease)).toEqual([]);
    const settled = startMonitoringPlan(stranded, afterLease);
    expect(settled.status).toBe("failed");
    expect(settled.error).toBe(MAX_MONITORING_ATTEMPTS_ERROR);
    expect(settled.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS);
  });

  test("the sweep terminalizes a plan stranded running at the cap", async () => {
    // A worker that died after the last allowed start leaves the plan
    // `running` at the cap. The batch will never readmit it, so the sweep must
    // settle it itself or it stays `running` forever.
    let current = plan();
    for (let attempt = 0; attempt < DEFAULT_MAX_MONITORING_ATTEMPTS - 1; attempt++) {
      current = failMonitoringPlan(
        startMonitoringPlan(current, day(100 + attempt)),
        "github 503",
        day(100 + attempt),
      );
    }
    const stranded = startMonitoringPlan(current, day(150));
    expect(stranded.status).toBe("running");
    expect(stranded.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS);

    let fetches = 0;
    const sweep = await runDueMonitoringPlans({
      plans: [stranded],
      identities: new Map([["p-1", identity]]),
      now: new Date(day(150).getTime() + DEFAULT_MONITORING_LEASE_MS * 10),
      collector: {
        async collect() {
          fetches++;
          return [evidence("recovered", 40)];
        },
      },
      judgments: serviceOf(acceptingJudgments),
    });
    expect(fetches).toBe(0);
    expect(sweep.fetchCount).toBe(0);
    expect(sweep.plans[0]?.status).toBe("failed");
    expect(sweep.plans[0]?.error).toBe(MAX_MONITORING_ATTEMPTS_ERROR);
    expect(sweep.plans[0]?.attemptCount).toBe(DEFAULT_MAX_MONITORING_ATTEMPTS);
    expect(sweep.results).toEqual([]);
  });

  test("an explicit lower cap stops a plan sooner", () => {
    const once = burnAttempts(1);
    expect(batchDueMonitoringPlans([once], day(200), DEFAULT_MONITORING_LEASE_MS, 1)).toEqual([]);
    expect(startMonitoringPlan(once, day(200), DEFAULT_MONITORING_LEASE_MS, 1)).toEqual(once);
    expect(batchDueMonitoringPlans([once], day(200), DEFAULT_MONITORING_LEASE_MS, 2)).toHaveLength(
      1,
    );
  });
});
