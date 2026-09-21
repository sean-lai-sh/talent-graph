/**
 * V0 Referral Signal as a model definition.
 *
 * Judge weights change the numbers, so they are provenance, not a silent
 * rewrite of referral_signal@0.1.0. They are another run's *output*, so they
 * are recorded as lineage — `upstreamRuns` carries
 * `{ role: "judge_weights", runId, digest }` — exactly as an anchored
 * Bradley–Terry refit records its prior. The version stays `spec.version`, so
 * `getSpec(run.kind, run.specVersion)` resolves for a weighted run too.
 */

import type { Person, Referral } from "../../domain/types.ts";
import { hashInputs } from "../../provenance/hash.ts";
import {
  computeAllReferralSignals,
  type ReferralSignalOptions,
  type ReferralSignalResult,
} from "../../scoring/referralSignal.ts";
import { defineModel, runModel } from "../define.ts";
import { CURRENT_SPECS } from "../registry.ts";
import type { ModelRun } from "../run.ts";

/** Options of a Referral Signal *run*: the scoring options plus lineage. */
export type ReferralSignalRunOptions = ReferralSignalOptions & {
  /** Id of the calibration ModelRun the judge weights came from. */
  judgeRunId?: string;
};

export interface ReferralSignalInput {
  people: readonly Person[];
  referrals: readonly Referral[];
}

/** True iff either judge weight map was passed. */
function isJudgeWeighted(opts: ReferralSignalOptions): boolean {
  return opts.judgeReliability !== undefined || opts.judgeBias !== undefined;
}

/**
 * Fingerprint of the weight *values* a run consumed. Both maps together, so
 * bias-only and reliability-only runs never collide; `hashInputs` sorts map
 * keys, so insertion order cannot move it.
 */
function judgeWeightsDigest(opts: ReferralSignalOptions): string {
  return hashInputs({
    judgeReliability: opts.judgeReliability ? new Map(opts.judgeReliability) : null,
    judgeBias: opts.judgeBias ? new Map(opts.judgeBias) : null,
  });
}

export const referralSignalModel = defineModel<
  "referral_signal",
  ReferralSignalInput,
  ReferralSignalRunOptions,
  Map<string, ReferralSignalResult>
>({
  name: "referral_signal_v0",
  kind: "referral_signal",
  specOf: (opts) => opts.spec ?? CURRENT_SPECS.referral_signal,
  inputsOf: ({ people, referrals }) => ({ people: people.map((p) => p.id), referrals }),
  // Every option this model accounts for. `runModel` refuses anything else,
  // so a future scoring option (a `weighting`, which would have to be
  // recorded by its stable `kind`, never by its closures) arrives as a loud
  // error rather than as a silent collision between two different numbers.
  recordedOptionKeys: ["spec", "topK", "judgeReliability", "judgeBias", "judgeRunId"],
  resolveOptions: (spec, opts) => {
    // An id with no weights behind it names an upstream run that never
    // touched a number: nothing to digest, so nothing would enter the hash
    // and two calls claiming different calibrations would share one id.
    // Refused rather than dropped, like any option provenance cannot carry.
    if (opts.judgeRunId !== undefined && !isJudgeWeighted(opts)) {
      throw new Error(
        "judgeRunId without judgeReliability or judgeBias on a referral_signal run: " +
          "the named calibration contributed no weights, so it cannot be recorded as lineage",
      );
    }
    return {
      parameters: {
        spec,
        topK: opts.topK ?? spec.topK,
      },
      // The weight maps are a calibration run's output, not a call-site
      // option, so they are recorded once — as a digest of the values
      // consumed, beside the id of the run that produced them. A digest is a
      // string, so no later mutation of the caller's maps can rewrite it.
      upstream: isJudgeWeighted(opts)
        ? [
            {
              role: "judge_weights",
              runId: opts.judgeRunId ?? null,
              digest: judgeWeightsDigest(opts),
            },
          ]
        : [],
    };
  },
  compute: ({ people, referrals }, spec, opts) =>
    computeAllReferralSignals(people, referrals, { ...opts, spec }),
});

/** Referral Signals for everyone, wrapped in a ModelRun. */
export function runReferralSignals(
  people: readonly Person[],
  referrals: readonly Referral[],
  now: Date,
  opts: ReferralSignalRunOptions = {},
): ModelRun<Map<string, ReferralSignalResult>> {
  return runModel(referralSignalModel, { people, referrals }, opts, now);
}
