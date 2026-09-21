/**
 * V0 Referral Signal as a model definition.
 *
 * Judge weights change the numbers, so they are provenance, not a silent
 * rewrite of referral_signal@0.1.0: a weighted run records the weight maps
 * and carries a tagged version.
 */

import type { Person, Referral } from "../../domain/types.ts";
import {
  computeAllReferralSignals,
  type ReferralSignalOptions,
  type ReferralSignalResult,
} from "../../scoring/referralSignal.ts";
import { defineModel, runModel } from "../define.ts";
import { CURRENT_SPECS } from "../registry.ts";
import type { ModelRun } from "../run.ts";

export interface ReferralSignalInput {
  people: readonly Person[];
  referrals: readonly Referral[];
}

/** True iff either judge weight map was passed; drives the version tag. */
function isJudgeWeighted(opts: ReferralSignalOptions): boolean {
  return opts.judgeReliability !== undefined || opts.judgeBias !== undefined;
}

export const referralSignalModel = defineModel<
  "referral_signal",
  ReferralSignalInput,
  ReferralSignalOptions,
  Map<string, ReferralSignalResult>
>({
  name: "referral_signal_v0",
  kind: "referral_signal",
  legacyId: "referral_signal_v0",
  specOf: (opts) => opts.spec ?? CURRENT_SPECS.referral_signal,
  // Weighted numbers are not the unweighted 0.1.0 identity; tag the run.
  versionOf: (spec, opts) =>
    isJudgeWeighted(opts) ? `${spec.version}+judge_reliability` : spec.version,
  inputsOf: ({ people, referrals }) => ({ people: people.map((p) => p.id), referrals }),
  resolveOptions: (spec, opts) => ({
    parameters: {
      spec,
      topK: opts.topK ?? spec.topK,
      // Copied so later map mutation cannot rewrite the record.
      // `judgeWeighted` is true iff either map was passed.
      judgeWeighted: isJudgeWeighted(opts),
      judgeReliability: opts.judgeReliability ? new Map(opts.judgeReliability) : null,
      judgeBias: opts.judgeBias ? new Map(opts.judgeBias) : null,
    },
    upstream: [],
  }),
  compute: ({ people, referrals }, spec, opts) =>
    computeAllReferralSignals(people, referrals, { ...opts, spec }),
});

/** Referral Signals for everyone, wrapped in a ModelRun. */
export function runReferralSignals(
  people: readonly Person[],
  referrals: readonly Referral[],
  now: Date,
  opts: ReferralSignalOptions = {},
): ModelRun<Map<string, ReferralSignalResult>> {
  return runModel(
    referralSignalModel,
    { people, referrals },
    referralSignalModel.specOf(opts),
    opts,
    now,
  );
}
