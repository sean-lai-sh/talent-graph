import type { Opportunity, Outcome } from "../domain/types.ts";
import { residualOutcomes } from "../judges/outcomes.ts";
import type { JudgeReliabilitySpec } from "../models/spec.ts";
import { CAREER_EVIDENCE_DIMENSIONS, MAX_LEVEL } from "./dimensions.ts";
import type { CareerEvent, LongitudinalResidualSlope } from "./types.ts";

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Translate accepted, evidence-backed events into the shipped V2 longitudinal
 * records. One outcome per event keeps cohort kinds interpretable; the raw
 * dimension judgments remain attached to CareerEvent for reporting.
 */
export function careerEventsToLongitudinalRecords(events: readonly CareerEvent[]): {
  outcomes: Outcome[];
  opportunities: Opportunity[];
} {
  const outcomes: Outcome[] = [];
  const opportunities: Opportunity[] = [];
  for (const event of events) {
    if (event.status !== "accepted") continue;
    if (event.kind === "selective_role_transition") {
      opportunities.push({
        id: `opportunity-${event.id}`,
        personId: event.personId,
        kind: "selective_role",
        description: event.title,
        startedAt: new Date(event.observedAt.getTime()),
        endedAt: null,
        createdAt: new Date(event.createdAt.getTime()),
      });
      continue;
    }
    const grouped = CAREER_EVIDENCE_DIMENSIONS.map((dimension) =>
      event.judgments.filter((judgment) => judgment.dimension === dimension),
    );
    if (
      grouped.some(
        (judgments) =>
          judgments.length !== 1 ||
          !Number.isFinite(judgments[0]?.score) ||
          (judgments[0]?.score ?? -1) < 0 ||
          (judgments[0]?.score ?? MAX_LEVEL + 1) > MAX_LEVEL,
      )
    ) {
      continue;
    }
    const values = grouped.map((judgments) => (judgments[0]?.score as number) / MAX_LEVEL);
    outcomes.push({
      id: `outcome-${event.id}`,
      personId: event.personId,
      opportunityId: null,
      kind: `career_event:${event.kind}`,
      value: mean(values),
      observedAt: new Date(event.observedAt.getTime()),
      createdAt: new Date(event.createdAt.getTime()),
    });
  }
  return { outcomes, opportunities };
}

/**
 * Reporting slope deliberately reuses the V2 opportunity-corrected residual
 * definition under the caller-supplied JudgeReliabilitySpec. A spec change can
 * move these values, so callers must record it in the monitoring pipeline
 * version rather than comparing runs as if their semantics were unchanged.
 */
export function residualSlope(
  personId: string,
  t0: Date,
  t1: Date,
  outcomes: readonly Outcome[],
  opportunities: readonly Opportunity[],
  spec: JudgeReliabilitySpec,
  minGapDays: number,
): LongitudinalResidualSlope {
  const gapDays = (t1.getTime() - t0.getTime()) / 86_400_000;
  if (!Number.isFinite(gapDays) || gapDays < minGapDays) {
    return {
      personId,
      t0: new Date(t0.getTime()),
      t1: new Date(t1.getTime()),
      residualT0: null,
      residualT1: null,
      delta: null,
      state: "undefined_window",
    };
  }

  const early = residualOutcomes(outcomes, opportunities, spec, t0).get(personId);
  const late = residualOutcomes(outcomes, opportunities, spec, t1).get(personId);
  if (!early) {
    return {
      personId,
      t0: new Date(t0.getTime()),
      t1: new Date(t1.getTime()),
      residualT0: null,
      residualT1: late?.residual ?? null,
      delta: null,
      state: "insufficient_early",
    };
  }
  if (!late) {
    return {
      personId,
      t0: new Date(t0.getTime()),
      t1: new Date(t1.getTime()),
      residualT0: early.residual,
      residualT1: null,
      delta: null,
      state: "insufficient_late",
    };
  }
  return {
    personId,
    t0: new Date(t0.getTime()),
    t1: new Date(t1.getTime()),
    residualT0: early.residual,
    residualT1: late.residual,
    delta: late.residual - early.residual,
    state: "defined",
  };
}
