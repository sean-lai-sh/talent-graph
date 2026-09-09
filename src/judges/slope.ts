/**
 * Causal residual slope ΔR*_v = R*_v(t1) − R*_v(t0).
 *
 * Each R* is the person-level snapshot from `residualOutcomes` (same
 * `buildOutcomeCohort` machinery) evaluated at that cutoff — not a new
 * residual. Undefined states are first-class. No scout math; nothing here
 * writes p̂_u, R_uv, or θ.
 *
 * Window is checked first. `slopeMinGapDays` comes from the spec; 2.0.0
 * omits it, so we default to 90 without mutating the spec. Cutoffs are
 * parameters — this file never reads the clock.
 */

import type { Opportunity, Outcome, ResidualSlope, ResidualSlopeState } from "../domain/types.ts";
import { CURRENT_SPECS } from "../models/registry.ts";
import { assertSpec, type JudgeReliabilitySpec } from "../models/spec.ts";
import { residualOutcomes } from "./outcomes.ts";

const DAY = 86_400_000;

/** Applied when the spec omits `slopeMinGapDays` (judge_reliability@2.0.0). */
export const DEFAULT_SLOPE_MIN_GAP_DAYS = 90;

export interface ResidualSlopeInput {
  personId: string;
  outcomes: readonly Outcome[];
  opportunities?: readonly Opportunity[];
  t0: Date;
  t1: Date;
  spec?: JudgeReliabilitySpec;
}

export interface ResidualSlopesInput {
  personIds: readonly string[];
  outcomes: readonly Outcome[];
  opportunities?: readonly Opportunity[];
  t0: Date;
  t1: Date;
  spec?: JudgeReliabilitySpec;
}

function slopeMinGapDays(spec: JudgeReliabilitySpec): number {
  return spec.slopeMinGapDays ?? DEFAULT_SLOPE_MIN_GAP_DAYS;
}

function windowIsValid(t0: Date, t1: Date, minGapDays: number): boolean {
  const gapMs = t1.getTime() - t0.getTime();
  return gapMs > 0 && gapMs / DAY >= minGapDays;
}

/**
 * Window-first state. Exported so tests can lock `insufficient_late`:
 * `residualOutcomes` snapshots are monotonic in the cutoff, so a person
 * present at t0 is present at any later t1 and the public functions cannot
 * produce that state from a single outcomes list.
 */
export function classifyResidualSlope(
  t0: Date,
  t1: Date,
  residualT0: number | null,
  residualT1: number | null,
  minGapDays: number,
): ResidualSlopeState {
  if (!windowIsValid(t0, t1, minGapDays)) return "undefined_window";
  if (residualT0 === null) return "insufficient_early";
  if (residualT1 === null) return "insufficient_late";
  return "defined";
}

function assemble(
  personId: string,
  t0: Date,
  t1: Date,
  residualT0: number | null,
  residualT1: number | null,
  minGapDays: number,
): ResidualSlope {
  const state = classifyResidualSlope(t0, t1, residualT0, residualT1, minGapDays);
  return {
    personId,
    t0: new Date(t0.getTime()),
    t1: new Date(t1.getTime()),
    residualT0,
    residualT1,
    delta:
      state === "defined" && residualT0 !== null && residualT1 !== null
        ? residualT1 - residualT0
        : null,
    state,
  };
}

/**
 * ΔR* for one person between two cutoffs. Residuals are always filled when
 * the snapshot at that cutoff has the person — including `undefined_window`,
 * where they are cheap to compute and useful for diagnosis. `delta` is null
 * unless `state` is `"defined"`.
 */
export function residualSlope(input: ResidualSlopeInput): ResidualSlope {
  return residualSlopes({ ...input, personIds: [input.personId] })[0] as ResidualSlope;
}

/**
 * ΔR* for each id in `personIds`, in that order. Snapshots at t0 and t1 are
 * built once and reused.
 */
export function residualSlopes(input: ResidualSlopesInput): ResidualSlope[] {
  const spec = assertSpec(input.spec ?? CURRENT_SPECS.judge_reliability);
  const opportunities = input.opportunities ?? [];
  const minGap = slopeMinGapDays(spec);
  const at0 = residualOutcomes(input.outcomes, opportunities, spec, input.t0);
  const at1 = residualOutcomes(input.outcomes, opportunities, spec, input.t1);
  return input.personIds.map((personId) =>
    assemble(
      personId,
      input.t0,
      input.t1,
      at0.get(personId)?.residual ?? null,
      at1.get(personId)?.residual ?? null,
      minGap,
    ),
  );
}
