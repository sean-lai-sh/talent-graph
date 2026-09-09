/**
 * Contribution trajectory: residual snapshots at a series of cutoffs, plus
 * the adjacent-pair slopes between them.
 *
 * Presentation only. Does not write p̂_u, R_uv, or θ, and is not read by
 * scoring, reliability, or Referral Signal. Each point is a reporting
 * snapshot (`residualOutcomes` at that cutoff). Adjacent windows call
 * `residualSlope` — this file does not reimplement ΔR*.
 *
 * Cutoffs are used in caller order and are not sorted. Callers should pass
 * increasing times; a decreasing pair yields `undefined_window` on that
 * slope, same as `residualSlope`. `now` is never read.
 */

import type { Opportunity, Outcome, ResidualSlope, ResidualSlopeState } from "../domain/types.ts";
import { CURRENT_SPECS } from "../models/registry.ts";
import { assertSpec, type JudgeReliabilitySpec } from "../models/spec.ts";
import { residualOutcomes } from "./outcomes.ts";
import { residualSlope } from "./slope.ts";

export interface ContributionTrajectoryInput {
  personId: string;
  /** Used in this order; not sorted. Prefer strictly increasing times. */
  cutoffs: readonly Date[];
  outcomes: readonly Outcome[];
  opportunities?: readonly Opportunity[];
  spec?: JudgeReliabilitySpec;
}

/** One cutoff in a trajectory. `state` is `"point"` — a snapshot, not a window. */
export interface TrajectoryPoint {
  at: Date;
  residual: number | null;
  state: ResidualSlopeState | "point";
}

export interface ContributionTrajectory {
  personId: string;
  points: TrajectoryPoint[];
  slopes: ResidualSlope[];
}

/**
 * Residual at each cutoff and ΔR* on each adjacent pair.
 *
 * `points.length === cutoffs.length`. Each residual is
 * `residualOutcomes(..., cutoff).get(personId)?.residual ?? null`.
 * `slopes.length === max(0, cutoffs.length - 1)`.
 */
export function contributionTrajectory(input: ContributionTrajectoryInput): ContributionTrajectory {
  const spec = assertSpec(input.spec ?? CURRENT_SPECS.judge_reliability);
  const opportunities = input.opportunities ?? [];
  const points = input.cutoffs.map((cutoff) => {
    const residual =
      residualOutcomes(input.outcomes, opportunities, spec, cutoff).get(input.personId)?.residual ??
      null;
    return {
      at: new Date(cutoff.getTime()),
      residual,
      state: "point" as const,
    };
  });
  const slopes: ResidualSlope[] = [];
  for (let i = 0; i < input.cutoffs.length - 1; i++) {
    const t0 = input.cutoffs[i];
    const t1 = input.cutoffs[i + 1];
    if (!t0 || !t1) continue;
    slopes.push(
      residualSlope({
        personId: input.personId,
        outcomes: input.outcomes,
        opportunities,
        t0,
        t1,
        spec,
      }),
    );
  }
  return { personId: input.personId, points, slopes };
}
