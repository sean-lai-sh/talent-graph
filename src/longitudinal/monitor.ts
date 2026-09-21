import {
  batchDueMonitoringPlans,
  completeMonitoringPlan,
  DEFAULT_MAX_MONITORING_ATTEMPTS,
  DEFAULT_MONITORING_LEASE_MS,
  failMonitoringPlan,
  startMonitoringPlan,
} from "./checkpoints.ts";
import type { JevJudgmentService } from "./judgments.ts";
import { processEvidence } from "./pipeline.ts";
import type { EvidenceRuntime, ProcessEvidenceResult } from "./policy.ts";
import type { CanonicalIdentity, GrokEvidenceItem, MonitoringPlan } from "./types.ts";

export interface EvidenceCollector {
  collect(identity: CanonicalIdentity, from: Date, cutoffAt: Date): Promise<GrokEvidenceItem[]>;
}

export interface MonitoringRunResult {
  plans: MonitoringPlan[];
  results: Array<{ planId: string; result: ProcessEvidenceResult }>;
  fetchCount: number;
}

export async function runDueMonitoringPlans(input: {
  plans: readonly MonitoringPlan[];
  identities: ReadonlyMap<string, CanonicalIdentity>;
  now: Date;
  collector: EvidenceCollector;
  judgments: JevJudgmentService;
  maxAttempts?: number;
  /**
   * Fan-out shape for each plan's pipeline call: the concurrency cap, per-item
   * isolation, the judgment store and the caller's cancellation. Passed
   * through untouched — the sweep decides *which* plans run, not how one plan
   * fans out — and a sweep given a store re-judges only what it has not
   * already observed.
   */
  runtime?: EvidenceRuntime;
}): Promise<MonitoringRunResult> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_MONITORING_ATTEMPTS;
  const start = (plan: MonitoringPlan) =>
    startMonitoringPlan(plan, input.now, DEFAULT_MONITORING_LEASE_MS, maxAttempts);
  const updates = new Map(input.plans.map((plan) => [plan.id, plan]));
  // A worker that died after the last allowed start leaves a plan `running` at
  // the cap, and the batch will never readmit it. `start` settles a stale lease
  // as failed and returns a live one untouched, so this only terminalizes what
  // is already abandoned, without a fetch.
  for (const plan of input.plans) {
    if (plan.status === "running" && plan.attemptCount >= maxAttempts) {
      updates.set(plan.id, start(plan));
    }
  }
  const results: MonitoringRunResult["results"] = [];
  const batches = batchDueMonitoringPlans(
    input.plans,
    input.now,
    DEFAULT_MONITORING_LEASE_MS,
    maxAttempts,
  );

  await Promise.all(
    batches.map(async (batch) => {
      const identity = input.identities.get(batch.personId);
      if (!identity) {
        for (const plan of batch.plans) {
          const running = start(plan);
          updates.set(
            plan.id,
            failMonitoringPlan(running, "canonical identity not found", input.now),
          );
        }
        return;
      }

      const from = new Date(Math.min(...batch.plans.map((plan) => plan.baselineAt.getTime())));
      let evidence: GrokEvidenceItem[];
      try {
        evidence = await input.collector.collect(identity, from, batch.cutoffAt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const plan of batch.plans) {
          const running = start(plan);
          updates.set(plan.id, failMonitoringPlan(running, message, input.now));
        }
        return;
      }

      for (const plan of batch.plans) {
        const running = start(plan);
        try {
          const result = await processEvidence({
            identity,
            evidence,
            baselineAt: plan.baselineAt,
            cutoffAt: plan.dueAt,
            retrievedAt: input.now,
            pipelineVersion: plan.pipelineVersion,
            judgments: input.judgments,
            ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
          });
          updates.set(
            plan.id,
            completeMonitoringPlan(running, result.snapshot.id, input.now, result.needsReview),
          );
          results.push({ planId: plan.id, result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          updates.set(plan.id, failMonitoringPlan(running, message, input.now));
        }
      }
    }),
  );

  return {
    plans: input.plans.map((plan) => updates.get(plan.id) as MonitoringPlan),
    results: results.sort((a, b) => a.planId.localeCompare(b.planId)),
    fetchCount: batches.length,
  };
}
