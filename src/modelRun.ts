/**
 * ModelRun — the reproducibility record for every inference run.
 *
 * `parameters` carries the **full** ModelSpec (kind, version, every weight),
 * and `inputHash` fingerprints the raw observations, so spec version + hash
 * are sufficient to reproduce any historical number exactly.
 */

import { DIMENSIONS } from "./domain/constants.ts";
import type { Comparison, Dimension, Person, Referral } from "./domain/types.ts";
import {
  type CapabilityOptions,
  type CapabilityRun,
  computeCapabilityVectors,
} from "./inference/capabilityVector.ts";
import {
  computeJudgeCalibration,
  type JudgeCalibrationInput,
  type JudgeCalibrationRun,
} from "./judges/reliability.ts";
import { CURRENT_SPECS } from "./models/registry.ts";
import type { ModelSpec } from "./models/spec.ts";
import {
  computeAllReferralSignals,
  type ReferralSignalOptions,
  type ReferralSignalResult,
} from "./scoring/referralSignal.ts";

export type ModelType = "referral_signal_v0" | "bradley_terry_v1" | "judge_reliability_v2";

export interface ModelRun<TOut = unknown> {
  id: string;
  modelType: ModelType;
  modelVersion: string;
  /** Always includes `spec: ModelSpec` plus any call-site options. */
  parameters: Record<string, unknown>;
  inputHash: string;
  createdAt: Date;
  outputs: TOut;
}

/** Deterministic JSON: object keys sorted, Dates as ISO strings, Maps as entries. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    return { __map: [...value.entries()].sort().map(([k, v]) => [k, normalise(v)]) };
  }
  if (value instanceof Set) return { __set: [...value].map(normalise).sort() };
  if (Array.isArray(value)) return value.map(normalise);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = normalise(obj[key]);
  return out;
}

/** SHA-256 hex of the stable JSON form. */
export function hashInputs(inputs: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(stableStringify(inputs));
  return hasher.digest("hex");
}

export function createModelRun<TOut>(
  modelType: ModelType,
  modelVersion: string,
  parameters: Record<string, unknown>,
  inputs: unknown,
  outputs: TOut,
  now: Date,
): ModelRun<TOut> {
  const inputHash = hashInputs(inputs);
  const paramHash = hashInputs(parameters).slice(0, 8);
  return {
    id: `${modelType}@${modelVersion}:${inputHash.slice(0, 12)}:${paramHash}`,
    modelType,
    modelVersion,
    parameters,
    inputHash,
    // A Date is mutable even inside a frozen record; never retain the caller's.
    createdAt: new Date(now.getTime()),
    outputs,
  };
}

/** Referral Signals for everyone, wrapped in a ModelRun. */
export function runReferralSignals(
  people: readonly Person[],
  referrals: readonly Referral[],
  now: Date,
  opts: ReferralSignalOptions = {},
): ModelRun<Map<string, ReferralSignalResult>> {
  const spec: ModelSpec = opts.spec ?? CURRENT_SPECS.referral_signal;
  const outputs = computeAllReferralSignals(people, referrals, opts);
  return createModelRun(
    "referral_signal_v0",
    spec.version,
    {
      spec,
      topK: opts.topK ?? spec.topK,
      // Judge weights change the numbers; they are provenance, not a silent
      // rewrite of referral_signal@0.1.0. Copied so later map mutation cannot
      // rewrite the record. `judgeWeighted` is true iff either map was passed.
      judgeWeighted: opts.judgeReliability !== undefined || opts.judgeBias !== undefined,
      judgeReliability: opts.judgeReliability ? new Map(opts.judgeReliability) : null,
      judgeBias: opts.judgeBias ? new Map(opts.judgeBias) : null,
    },
    { people: people.map((p) => p.id), referrals },
    outputs,
    now,
  );
}

/** V2 judge calibration wrapped in a ModelRun. `now` is the evaluation time step. */
export function runJudgeCalibration(input: JudgeCalibrationInput): ModelRun<JudgeCalibrationRun> {
  const spec = input.spec ?? CURRENT_SPECS.judge_reliability;
  const referralSpec = input.referralSpec ?? CURRENT_SPECS.referral_signal;
  const outputs = computeJudgeCalibration(input);
  return createModelRun(
    "judge_reliability_v2",
    spec.version,
    { spec, referralSpec, now: new Date(input.now.getTime()) },
    {
      people: input.people.map((p) => p.id),
      referrals: input.referrals,
      outcomes: input.outcomes,
      opportunities: input.opportunities ?? [],
    },
    outputs,
    input.now,
  );
}

export type CapabilityRunOptions = CapabilityOptions & {
  /** Id of the ModelRun that `previous` came from, recorded for provenance. */
  previousRunId?: string;
};

/**
 * Per-dimension θ maps of a previous run, in the form the anchor prior
 * consumes. Hashing this (rather than the whole run) fingerprints exactly
 * what influenced the refit.
 */
function previousThetas(previous: CapabilityRun): Record<Dimension, Map<string, number>> {
  const out = {} as Record<Dimension, Map<string, number>>;
  for (const d of DIMENSIONS) {
    out[d] = new Map(previous.runsByDimension[d].fits.map((f) => [f.personId, f.theta]));
  }
  return out;
}

/**
 * Relative Capability Estimates for everyone, wrapped in a ModelRun.
 *
 * `parameters` lists every input that can change the numbers, explicitly:
 * an anchored refit records the effective κ and a hash of the previous θ
 * values, so two refits against different priors never share an id.
 */
export function runCapabilityVectors(
  people: readonly Person[],
  comparisons: readonly Comparison[],
  now: Date,
  opts: CapabilityRunOptions = {},
): ModelRun<CapabilityRun> {
  const spec = opts.spec ?? CURRENT_SPECS.bradley_terry;
  const { previousRunId, ...capabilityOpts } = opts;
  const { previous } = capabilityOpts;
  const outputs = computeCapabilityVectors(people, comparisons, capabilityOpts);
  const anchorStrength = previous === undefined ? 0 : (opts.anchorStrength ?? spec.anchorStrength);
  return createModelRun(
    "bradley_terry_v1",
    spec.version,
    {
      spec,
      minComparisons: outputs.options.minComparisons,
      minOpponents: outputs.options.minOpponents,
      tieHandling: outputs.options.tieHandling,
      anchored: previous !== undefined,
      anchorStrength,
      bt: opts.bt ?? null,
      previousRunId: previousRunId ?? null,
      previousThetaHash: previous === undefined ? null : hashInputs(previousThetas(previous)),
    },
    { people: people.map((p) => p.id), comparisons },
    outputs,
    now,
  );
}
