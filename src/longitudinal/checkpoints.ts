import type { MonitoringPlan } from "./types.ts";

const DAY_MS = 86_400_000;
export const DEFAULT_MONITORING_LEASE_MS = 15 * 60 * 1000;
/** Attempts a single monitoring plan may consume before it stops being retried. */
export const DEFAULT_MAX_MONITORING_ATTEMPTS = 3;
/** Error recorded on a plan whose attempts are spent. */
export const MAX_MONITORING_ATTEMPTS_ERROR = "max attempts reached";

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

export function batchDueMonitoringPlans(
  plans: readonly MonitoringPlan[],
  now: Date,
  runningLeaseMs = DEFAULT_MONITORING_LEASE_MS,
  maxAttempts = DEFAULT_MAX_MONITORING_ATTEMPTS,
): DuePersonBatch[] {
  const groups = new Map<string, DuePersonBatch>();
  for (const plan of plans) {
    if (
      !monitoringPlanIsRetryable(plan, now, runningLeaseMs, maxAttempts) ||
      plan.dueAt.getTime() > now.getTime()
    ) {
      continue;
    }
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

export function startMonitoringPlan(
  plan: MonitoringPlan,
  attemptedAt: Date,
  runningLeaseMs = DEFAULT_MONITORING_LEASE_MS,
  maxAttempts = DEFAULT_MAX_MONITORING_ATTEMPTS,
): MonitoringPlan {
  if (!leaseIsFree(plan, attemptedAt, runningLeaseMs)) return plan;
  // Attempts are spent: the plan settles as `failed` and never runs again. A
  // plan that is already `failed` keeps the error that got it there; only a
  // stale `running` lease is converted, so nothing can loop back to `running`.
  if (plan.attemptCount >= maxAttempts) {
    return plan.status === "failed"
      ? plan
      : { ...plan, status: "failed", error: MAX_MONITORING_ATTEMPTS_ERROR };
  }
  return {
    ...plan,
    status: "running",
    attemptCount: plan.attemptCount + 1,
    lastAttemptAt: new Date(attemptedAt.getTime()),
    error: null,
  };
}

function monitoringPlanIsRetryable(
  plan: MonitoringPlan,
  now: Date,
  runningLeaseMs: number,
  maxAttempts: number,
): boolean {
  return plan.attemptCount < maxAttempts && leaseIsFree(plan, now, runningLeaseMs);
}

function leaseIsFree(plan: MonitoringPlan, now: Date, runningLeaseMs: number): boolean {
  if (plan.status === "pending" || plan.status === "failed") return true;
  if (plan.status !== "running") return false;
  if (plan.lastAttemptAt === null) return true;
  return now.getTime() - plan.lastAttemptAt.getTime() >= runningLeaseMs;
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
