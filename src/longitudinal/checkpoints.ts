import type { MonitoringPlan } from "./types.ts";

const DAY_MS = 86_400_000;

export interface CreateMonitoringPlanInput {
  id: string;
  personId: string;
  caseId: string;
  submittedAt?: Date;
  caseOpenedAt: Date;
  horizonDays: 90 | 180;
  pipelineVersion: string;
  baselineSnapshotId?: string;
}

/** Freeze the organization's selected horizon when the case is opened. */
export function createMonitoringPlan(input: CreateMonitoringPlanInput): MonitoringPlan {
  const baselineAt = new Date((input.submittedAt ?? input.caseOpenedAt).getTime());
  return {
    id: input.id,
    personId: input.personId,
    caseId: input.caseId,
    baselineAt,
    horizonDays: input.horizonDays,
    dueAt: new Date(baselineAt.getTime() + input.horizonDays * DAY_MS),
    pipelineVersion: input.pipelineVersion,
    status: "pending",
    attemptCount: 0,
    lastAttemptAt: null,
    completedAt: null,
    baselineSnapshotId: input.baselineSnapshotId ?? null,
    resultSnapshotId: null,
    error: null,
  };
}

export function checkpointJobKey(plan: MonitoringPlan): string {
  return `${plan.id}:${plan.dueAt.toISOString()}:${plan.pipelineVersion}`;
}

export interface DuePersonBatch {
  personId: string;
  cutoffAt: Date;
  plans: MonitoringPlan[];
}

/**
 * Select due plans and group them into collection batches.
 *
 * All due plans for one person share a fetch through the latest due cutoff.
 * Evaluation still uses each plan's own dueAt, so later facts cannot leak into
 * an earlier checkpoint.
 */
export function batchDueMonitoringPlans(
  plans: readonly MonitoringPlan[],
  now: Date,
): DuePersonBatch[] {
  const groups = new Map<string, DuePersonBatch>();
  for (const plan of plans) {
    if (plan.status !== "pending" || plan.dueAt.getTime() > now.getTime()) continue;
    const existing = groups.get(plan.personId);
    if (existing) {
      existing.plans.push(plan);
      if (plan.dueAt.getTime() > existing.cutoffAt.getTime()) {
        existing.cutoffAt = new Date(plan.dueAt.getTime());
      }
    } else {
      groups.set(plan.personId, {
        personId: plan.personId,
        cutoffAt: new Date(plan.dueAt.getTime()),
        plans: [plan],
      });
    }
  }

  return [...groups.values()]
    .map((batch) => ({
      ...batch,
      plans: [...batch.plans].sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort(
      (a, b) => a.cutoffAt.getTime() - b.cutoffAt.getTime() || a.personId.localeCompare(b.personId),
    );
}

export function startMonitoringPlan(plan: MonitoringPlan, attemptedAt: Date): MonitoringPlan {
  if (plan.status !== "pending" && plan.status !== "failed") return plan;
  return {
    ...plan,
    status: "running",
    attemptCount: plan.attemptCount + 1,
    lastAttemptAt: new Date(attemptedAt.getTime()),
    error: null,
  };
}

export function completeMonitoringPlan(
  plan: MonitoringPlan,
  resultSnapshotId: string,
  completedAt: Date,
  needsReview = false,
): MonitoringPlan {
  return {
    ...plan,
    status: needsReview ? "review" : "completed",
    resultSnapshotId,
    completedAt: new Date(completedAt.getTime()),
    error: null,
  };
}

export function failMonitoringPlan(
  plan: MonitoringPlan,
  error: string,
  failedAt: Date,
): MonitoringPlan {
  return {
    ...plan,
    status: "failed",
    lastAttemptAt: new Date(failedAt.getTime()),
    error,
  };
}
