/**
 * `advance()` — one pass of the engine over the observations.
 *
 * This is the only place the **calibration → weights → signal** order is
 * written. Everything else (the demo script, the drift script, an
 * application's engine) calls this and reads runs off the result, so the
 * order cannot drift apart between callers.
 *
 * Pure. `now` is a parameter — the evaluation time step T that the
 * calibration labels against and that every run is stamped with — and is
 * never read from the clock; `tests/invariants.test.ts` asserts that no file
 * under `src/pipeline/` calls `Date.now()` or `new Date()`.
 *
 * One run per kind. A pass produces a `judge_reliability` run, a
 * `bradley_terry` run and a `referral_signal` run, and never combines two
 * kinds into one number: Referral Signal and Relative Capability stay two
 * channels, and the calibration is a third. The judge-weighted Referral
 * Signal run is the same *kind* recomputed with another run's output as
 * weights — recorded as `judge_weights` lineage, not as a merged score.
 */

import {
  capabilityDrift,
  DEFAULT_DRIFT_THRESHOLDS,
  type DriftReport,
  type DriftThresholds,
  judgeReliabilityDrift,
  referralSignalDrift,
} from "../analysis/drift.ts";
import type { LoadedSpecs } from "../config.ts";
import { DIMENSIONS } from "../domain/constants.ts";
import type { Comparison, Opportunity, Outcome, Person, Referral } from "../domain/types.ts";
import type { CapabilityRun } from "../inference/capabilityVector.ts";
import { type JudgeCalibrationRun, judgeWeightOptions } from "../judges/reliability.ts";
import { runCapabilityVectors } from "../models/definitions/bradleyTerry.ts";
import { runJudgeCalibration } from "../models/definitions/judgeReliability.ts";
import { runReferralSignals } from "../models/definitions/referralSignal.ts";
import type { ModelRun } from "../models/run.ts";
import type { ReferralSignalResult } from "../scoring/referralSignal.ts";

/** The raw observations a pass reads. Immutable; nothing here is rewritten. */
export interface Observations {
  people: readonly Person[];
  referrals: readonly Referral[];
  comparisons: readonly Comparison[];
  outcomes: readonly Outcome[];
  opportunities: readonly Opportunity[];
}

/**
 * What each kind's run carries in `outputs` — and, because it is keyed by
 * kind, the list of kinds a pass runs at all. A `ModelSpec` kind can be
 * registered without appearing here: a rubric spec, say, is versioned data
 * the pipeline never evaluates. Nothing in this module is keyed on the
 * `ModelSpecKind` union, so such a kind is simply not one of ours rather
 * than a hole to index into.
 */
interface RunOutputs {
  referral_signal: Map<string, ReferralSignalResult>;
  bradley_terry: CapabilityRun;
  judge_reliability: JudgeCalibrationRun;
}

/** The kinds `advance` runs. A subset of `ModelSpecKind`, never all of it. */
export type PipelineKind = keyof RunOutputs;

/** A run of a kind the pipeline runs, with its outputs typed. */
export type RunOfKind<K extends PipelineKind> = ModelRun<RunOutputs[K]>;

/**
 * The kinds a pass can drift-compare: the ones it runs *and* the loaded
 * specs carry. A kind the deployment cannot tune (no `LoadedSpecs` key) and a
 * kind the pipeline never evaluates (no `RunOutputs` key) are both excluded,
 * at compile time rather than by a runtime surprise.
 */
export type DriftKind = PipelineKind & keyof LoadedSpecs;

/**
 * Membership test for `PipelineKind`, written as a total record so that
 * adding a kind to `RunOutputs` without listing it here — or listing one that
 * is not there — is a compile error.
 */
const PIPELINE_KINDS: Readonly<Record<PipelineKind, true>> = Object.freeze({
  bradley_terry: true,
  judge_reliability: true,
  referral_signal: true,
});

/** The `DriftKind`s of a given `LoadedSpecs`, sorted. */
export function driftKinds(specs: LoadedSpecs): DriftKind[] {
  return Object.keys(specs)
    .filter((k): k is DriftKind => k in PIPELINE_KINDS)
    .sort();
}

/**
 * What one pass hands to the next: the current run of each kind.
 *
 * A kind that has not run has **no key** — never a key with `undefined`
 * behind it. The `referral_signal` entry is the V0 baseline: the run of that
 * kind computed from the raw observations under that kind's spec alone. The
 * judge-weighted run is returned in `AdvanceResult.runs` instead, because its
 * numbers also depend on the `judge_reliability` spec, so comparing it
 * against a previous pass would attribute another kind's movement to this
 * one.
 */
export interface EngineState {
  runs: Partial<{ [K in PipelineKind]: RunOfKind<K> }>;
}

export interface AdvanceOptions {
  /** Anchor the BT refit on the previous run. Default false. */
  anchor?: boolean;
  /** Drop referrals with `createdAt > now`. Default false. */
  asOf?: boolean;
  /** Drift prev-vs-new per kind. `false` skips; default: the standard thresholds. */
  drift?: DriftThresholds | false;
}

export interface AdvanceResult {
  /** One run per kind — what the next pass compares and anchors against. */
  state: EngineState;
  /**
   * Every run this pass produced, in evaluation order. Two share the kind
   * `referral_signal` — the V0 baseline and the judge-weighted V2 run — and
   * are told apart by the `judge_weights` entry in `upstreamRuns`
   * (`baselineReferralRun` / `judgeWeightedReferralRun`).
   */
  runs: readonly ModelRun[];
  /** Empty when there is no previous state, or when `drift` is `false`. */
  drift: readonly DriftReport[];
}

/** True for the judge-weighted Referral Signal run of a pass. */
function isJudgeWeighted(run: ModelRun): boolean {
  return run.upstreamRuns.some((u) => u.role === "judge_weights");
}

/** The V0 Referral Signal run: raw observations, no judge weights. */
export function baselineReferralRun(result: AdvanceResult): RunOfKind<"referral_signal"> {
  const run = result.runs.find((r) => r.kind === "referral_signal" && !isJudgeWeighted(r));
  if (run === undefined) throw new Error("advance produced no referral_signal run");
  return run as RunOfKind<"referral_signal">;
}

/** The judge-weighted (V2) Referral Signal run of a pass. */
export function judgeWeightedReferralRun(result: AdvanceResult): RunOfKind<"referral_signal"> {
  const run = result.runs.find((r) => r.kind === "referral_signal" && isJudgeWeighted(r));
  if (run === undefined) throw new Error("advance produced no judge-weighted referral_signal run");
  return run as RunOfKind<"referral_signal">;
}

/**
 * The state's run of a kind, or an error naming the kind. A caller that
 * knows the pass ran a kind should not have to re-narrow `undefined`; a
 * caller that does not know asks `state.runs` directly.
 */
export function requireRun<K extends PipelineKind>(state: EngineState, kind: K): RunOfKind<K> {
  const run = state.runs[kind];
  if (run === undefined) throw new Error(`no ${kind} run in this state`);
  return run;
}

/** Referrals an as-of pass may see: made at or before the time step. */
function referralsAsOf(referrals: readonly Referral[], now: Date): readonly Referral[] {
  const t = now.getTime();
  return referrals.filter((r) => r.createdAt.getTime() <= t);
}

/**
 * One pass: V0 Referral Signal, Relative Capability, judge calibration, then
 * the judge-weighted Referral Signal — calibration first, because its output
 * is the weights the last step consumes.
 */
export function advance(
  prev: EngineState | null,
  observations: Observations,
  specs: LoadedSpecs,
  now: Date,
  opts: AdvanceOptions = {},
): AdvanceResult {
  const { people, comparisons, outcomes, opportunities } = observations;
  const referrals =
    opts.asOf === true ? referralsAsOf(observations.referrals, now) : observations.referrals;

  // V0 — Referral Signal from the raw referrals, all judges equal.
  const signals = runReferralSignals(people, referrals, now, { spec: specs.referral_signal });

  // V1 — Relative Capability. An anchored refit is pulled toward the previous
  // fit; `previousRunId` beside `previous`, never one without the other.
  const previous = opts.anchor === true ? prev?.runs.bradley_terry : undefined;
  const capability = runCapabilityVectors(people, comparisons, now, {
    spec: specs.bradley_terry,
    ...(previous === undefined ? {} : { previous: previous.outputs, previousRunId: previous.id }),
  });

  // V2 — judge calibration at T, grounded in outcomes only.
  const calibration = runJudgeCalibration({
    people,
    referrals,
    outcomes,
    opportunities,
    now,
    spec: specs.judge_reliability,
    referralSpec: specs.referral_signal,
  });

  // …then the weights it produced, applied to the same Referral Signal spec.
  // The calibration run is named as lineage, so the two runs of this kind are
  // distinguishable by provenance rather than by a version tag.
  const weighted = runReferralSignals(people, referrals, now, {
    spec: specs.referral_signal,
    ...judgeWeightOptions(calibration.outputs),
    judgeRunId: calibration.id,
  });

  const state: EngineState = {
    runs: {
      referral_signal: signals,
      bradley_terry: capability,
      judge_reliability: calibration,
    },
  };
  const runs: readonly ModelRun[] = [signals, capability, calibration, weighted];

  return { state, runs, drift: driftReports(prev, state, opts.drift) };
}

/** Prev-vs-new, per kind, on the runs each state carries. */
function driftReports(
  prev: EngineState | null,
  next: EngineState,
  thresholds: DriftThresholds | false | undefined,
): readonly DriftReport[] {
  if (prev === null || thresholds === false) return [];
  const t = thresholds ?? DEFAULT_DRIFT_THRESHOLDS;
  const reports: DriftReport[] = [];

  const beforeSignals = prev.runs.referral_signal;
  const afterSignals = next.runs.referral_signal;
  if (beforeSignals !== undefined && afterSignals !== undefined) {
    reports.push(referralSignalDrift(beforeSignals.outputs, afterSignals.outputs, t));
  }

  const beforeCapability = prev.runs.bradley_terry;
  const afterCapability = next.runs.bradley_terry;
  if (beforeCapability !== undefined && afterCapability !== undefined) {
    for (const d of DIMENSIONS) {
      reports.push(capabilityDrift(beforeCapability.outputs, afterCapability.outputs, d, t));
    }
  }

  const beforeJudges = prev.runs.judge_reliability;
  const afterJudges = next.runs.judge_reliability;
  if (beforeJudges !== undefined && afterJudges !== undefined) {
    for (const measure of ["reliability", "bias"] as const) {
      reports.push(judgeReliabilityDrift(beforeJudges.outputs, afterJudges.outputs, measure, t));
    }
  }

  return reports;
}
