/**
 * V2 judge calibration as a model definition.
 *
 * The evaluation time step T is an option, not an observation: the same
 * referrals and outcomes read at a later T produce different labels, so T
 * belongs in `parameters` and moves the run id.
 */

import type { Opportunity, Outcome, Person, Referral } from "../../domain/types.ts";
import {
  computeJudgeCalibration,
  type JudgeCalibrationInput,
  type JudgeCalibrationRun,
} from "../../judges/reliability.ts";
import { defineModel, runModel } from "../define.ts";
import { CURRENT_SPECS } from "../registry.ts";
import type { ModelRun } from "../run.ts";
import type { JudgeReliabilitySpec, ReferralSignalSpec } from "../spec.ts";

/** The raw observations a calibration reads. */
export interface JudgeCalibrationObservations {
  people: readonly Person[];
  referrals: readonly Referral[];
  outcomes: readonly Outcome[];
  opportunities?: readonly Opportunity[];
}

/** Everything that is a choice rather than an observation. */
export interface JudgeCalibrationOptions {
  /** The evaluation time step T. */
  now: Date;
  spec?: JudgeReliabilitySpec;
  /** Spec under which x_uv is computed. */
  referralSpec?: ReferralSignalSpec;
}

export const judgeReliabilityModel = defineModel<
  "judge_reliability",
  JudgeCalibrationObservations,
  JudgeCalibrationOptions,
  JudgeCalibrationRun
>({
  name: "judge_reliability_v2",
  kind: "judge_reliability",
  specOf: (opts) => opts.spec ?? CURRENT_SPECS.judge_reliability,
  inputsOf: (input) => ({
    people: input.people.map((p) => p.id),
    referrals: input.referrals,
    outcomes: input.outcomes,
    opportunities: input.opportunities ?? [],
  }),
  // Every option this model accounts for. `runModel` refuses anything else.
  recordedOptionKeys: ["now", "spec", "referralSpec"],
  resolveOptions: (spec, opts) => ({
    parameters: {
      spec,
      referralSpec: opts.referralSpec ?? CURRENT_SPECS.referral_signal,
      // A Date is mutable; never retain the caller's.
      now: new Date(opts.now.getTime()),
    },
    // A calibration reads raw observations only: no run feeds it.
    upstream: [],
  }),
  compute: (input, spec, opts) =>
    computeJudgeCalibration({
      ...input,
      now: opts.now,
      spec,
      referralSpec: opts.referralSpec ?? CURRENT_SPECS.referral_signal,
    }),
});

/** V2 judge calibration wrapped in a ModelRun. `now` is the evaluation time step. */
export function runJudgeCalibration(input: JudgeCalibrationInput): ModelRun<JudgeCalibrationRun> {
  const opts: JudgeCalibrationOptions = {
    now: input.now,
    ...(input.spec === undefined ? {} : { spec: input.spec }),
    ...(input.referralSpec === undefined ? {} : { referralSpec: input.referralSpec }),
  };
  return runModel(judgeReliabilityModel, input, opts, input.now);
}
