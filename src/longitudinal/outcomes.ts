import type { Opportunity, Outcome } from "../domain/types.ts";
import { residualOutcomes } from "../judges/outcomes.ts";
import type { JudgeReliabilitySpec } from "../models/spec.ts";
import type { CareerEvent, LongitudinalResidualSlope, ProgressDimension } from "./types.ts";

const OUTCOME_DIMENSIONS: readonly ProgressDimension[] = [
  "difficulty",
  "ownership",
  "external_impact",
  "originality",
  "peer_validation",
];

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
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
    const values = OUTCOME_DIMENSIONS.flatMap((dimension) =>
      event.judgments
        .filter((judgment) => judgment.dimension === dimension)
        .map((judgment) => judgment.score / 4),
    );
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
