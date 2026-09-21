/**
 * Monitoring plans over time: horizons, cutoffs, leases and readmission.
 *
 * The time concept, with no judgment in it beyond what a sweep needs to run:
 * frozen 90/180-day horizons, one fetch serving staggered checkpoints without
 * cutoff leakage, and a failed or stale-running plan re-entering the next
 * batch.
 */

import { describe, expect, test } from "bun:test";
import {
  batchDueMonitoringPlans,
  checkpointJobKey,
  createMonitoringPlan,
  DEFAULT_MONITORING_LEASE_MS,
  failMonitoringPlan,
  runDueMonitoringPlans,
  startMonitoringPlan,
} from "../src/index.ts";
import { acceptingJudgments, day, evidence, identity, serviceOf } from "./helpers/longitudinal.ts";

describe("checkpoint scheduling", () => {
  test("freezes 90/180-day horizons and groups all due cases by person", () => {
    const p90 = createMonitoringPlan({
      id: "m-90",
      personId: "p-1",
      caseId: "c-1",
      caseOpenedAt: day(0),
      horizonDays: 90,
      pipelineVersion: "1",
    });
    const p180 = createMonitoringPlan({
      id: "m-180",
      personId: "p-1",
      caseId: "c-2",
      submittedAt: day(5),
      caseOpenedAt: day(0),
      horizonDays: 180,
      pipelineVersion: "1",
    });
    expect(p90.dueAt).toEqual(day(90));
    expect(p180.dueAt).toEqual(day(185));
    expect(checkpointJobKey(p90)).toContain("m-90:2026-04-01");
    const batches = batchDueMonitoringPlans([p90, p180], day(200));
    expect(batches).toHaveLength(1);
    expect(batches[0]?.plans).toHaveLength(2);
    expect(batches[0]?.cutoffAt).toEqual(day(185));
  });

  test("one person fetch serves staggered checkpoints without cutoff leakage", async () => {
    const plans = [
      createMonitoringPlan({
        id: "early",
        personId: "p-1",
        caseId: "c-1",
        caseOpenedAt: day(0),
        horizonDays: 90,
        pipelineVersion: "1",
      }),
      createMonitoringPlan({
        id: "late",
        personId: "p-1",
        caseId: "c-2",
        caseOpenedAt: day(0),
        horizonDays: 180,
        pipelineVersion: "1",
      }),
    ];
    let fetches = 0;
    const run = await runDueMonitoringPlans({
      plans,
      identities: new Map([["p-1", identity]]),
      now: day(200),
      collector: {
        async collect() {
          fetches++;
          return [evidence("early-event", 80), evidence("late-event", 120)];
        },
      },
      judgments: serviceOf(acceptingJudgments),
    });
    expect(fetches).toBe(1);
    expect(run.fetchCount).toBe(1);
    expect(run.results.find((result) => result.planId === "early")?.result.events).toHaveLength(1);
    expect(run.results.find((result) => result.planId === "late")?.result.events).toHaveLength(2);
    expect(run.plans.every((plan) => plan.status === "completed")).toBe(true);
  });

  test("failed due plans re-enter the next collection batch", () => {
    const pending = createMonitoringPlan({
      id: "m-90",
      personId: "p-1",
      caseId: "c-1",
      caseOpenedAt: day(0),
      horizonDays: 90,
      pipelineVersion: "1",
    });
    const failed = failMonitoringPlan(pending, "collector timeout", day(100));
    const batches = batchDueMonitoringPlans([failed], day(200));
    expect(batches).toHaveLength(1);
    expect(batches[0]?.plans).toHaveLength(1);
    expect(batches[0]?.plans[0]?.status).toBe("failed");
  });

  test("running plans retry only after their lease expires", () => {
    const pending = createMonitoringPlan({
      id: "leased",
      personId: "p-1",
      caseId: "c-1",
      caseOpenedAt: day(0),
      horizonDays: 90,
      pipelineVersion: "1",
    });
    const attemptedAt = day(100);
    const running = startMonitoringPlan(pending, attemptedAt);
    expect(
      batchDueMonitoringPlans(
        [running],
        new Date(attemptedAt.getTime() + DEFAULT_MONITORING_LEASE_MS - 1),
      ),
    ).toHaveLength(0);
    expect(
      batchDueMonitoringPlans(
        [running],
        new Date(attemptedAt.getTime() + DEFAULT_MONITORING_LEASE_MS),
      ),
    ).toHaveLength(1);
  });

  test("shared fetch still filters each plan to its own baseline window", async () => {
    const early = createMonitoringPlan({
      id: "early",
      personId: "p-1",
      caseId: "c-1",
      caseOpenedAt: day(0),
      horizonDays: 90,
      pipelineVersion: "1",
    });
    const late = createMonitoringPlan({
      id: "late",
      personId: "p-1",
      caseId: "c-2",
      submittedAt: day(30),
      caseOpenedAt: day(0),
      horizonDays: 180,
      pipelineVersion: "1",
    });
    let fetches = 0;
    const run = await runDueMonitoringPlans({
      plans: [early, late],
      identities: new Map([["p-1", identity]]),
      now: day(220),
      collector: {
        async collect() {
          fetches++;
          return [
            evidence("pre-late-baseline", 10),
            evidence("shared", 80),
            evidence("late-only", 120),
          ];
        },
      },
      judgments: serviceOf(acceptingJudgments),
    });
    expect(fetches).toBe(1);
    expect(
      run.results
        .find((result) => result.planId === "early")
        ?.result.events.map((event) => event.title),
    ).toEqual(["Avery released pre-late-baseline.", "Avery released shared."]);
    expect(
      run.results
        .find((result) => result.planId === "late")
        ?.result.events.map((event) => event.title),
    ).toEqual(["Avery released shared.", "Avery released late-only."]);
  });

  test("a recovered collector retries a previously failed plan", async () => {
    const plan = failMonitoringPlan(
      createMonitoringPlan({
        id: "retry",
        personId: "p-1",
        caseId: "c-1",
        caseOpenedAt: day(0),
        horizonDays: 90,
        pipelineVersion: "1",
      }),
      "github 503",
      day(100),
    );
    const run = await runDueMonitoringPlans({
      plans: [plan],
      identities: new Map([["p-1", identity]]),
      now: day(200),
      collector: {
        async collect() {
          return [evidence("recovered", 40)];
        },
      },
      judgments: serviceOf(acceptingJudgments),
    });
    expect(run.plans[0]?.status).toBe("completed");
    expect(run.plans[0]?.attemptCount).toBe(1);
    expect(run.results[0]?.result.events).toHaveLength(1);
  });
});
