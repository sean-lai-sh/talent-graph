import {
  batchDueMonitoringPlans,
  completeMonitoringPlan,
  failMonitoringPlan,
  startMonitoringPlan,
} from "./checkpoints.ts";
import type { JevJudgmentService } from "./judgments.ts";
import { type ProcessEvidenceResult, processEvidence } from "./pipeline.ts";
import type { CanonicalIdentity, GrokEvidenceItem, MonitoringPlan } from "./types.ts";

export interface EvidenceCollector {
  collect(identity: CanonicalIdentity, from: Date, cutoffAt: Date): Promise<GrokEvidenceItem[]>;
}

export interface MonitoringRunResult {
  plans: MonitoringPlan[];
  results: Array<{ planId: string; result: ProcessEvidenceResult }>;
  fetchCount: number;
}

/**
 * Process all due plans. Collection is deduplicated by person; semantic
 * evaluation remains anchored to each plan's immutable dueAt.
 */
export async function runDueMonitoringPlans(input: {
  plans: readonly MonitoringPlan[];
  identities: ReadonlyMap<string, CanonicalIdentity>;
  now: Date;
  collector: EvidenceCollector;
  judgments: JevJudgmentService;
}): Promise<MonitoringRunResult> {
  const updates = new Map(input.plans.map((plan) => [plan.id, plan]));
  const results: MonitoringRunResult["results"] = [];
  const batches = batchDueMonitoringPlans(input.plans, input.now);

  await Promise.all(
    batches.map(async (batch) => {
      const identity = input.identities.get(batch.personId);
      if (!identity) {
        for (const plan of batch.plans) {
          updates.set(plan.id, failMonitoringPlan(plan, "canonical identity not found", input.now));
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
          const running = startMonitoringPlan(plan, input.now);
          updates.set(plan.id, failMonitoringPlan(running, message, input.now));
        }
        return;
      }

      for (const plan of batch.plans) {
        const running = startMonitoringPlan(plan, input.now);
        try {
          const result = await processEvidence({
            identity,
            evidence,
            baselineAt: plan.baselineAt,
            cutoffAt: plan.dueAt,
            retrievedAt: input.now,
            pipelineVersion: plan.pipelineVersion,
            judgments: input.judgments,
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
