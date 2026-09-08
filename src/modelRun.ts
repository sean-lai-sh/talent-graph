/**
 * ModelRun — the reproducibility record for every inference run.
 *
 * `parameters` carries the **full** ModelSpec (kind, version, every weight),
 * and `inputHash` fingerprints the raw observations, so spec version + hash
 * are sufficient to reproduce any historical number exactly.
 */

import type { Comparison, Person, Referral } from "./domain/types.ts";
import {
  type CapabilityOptions,
  type CapabilityRun,
  computeCapabilityVectors,
} from "./inference/capabilityVector.ts";
import { CURRENT_SPECS } from "./models/registry.ts";
import type { ModelSpec } from "./models/spec.ts";
import {
  computeAllReferralSignals,
  type ReferralSignalOptions,
  type ReferralSignalResult,
} from "./scoring/referralSignal.ts";

export type ModelType = "referral_signal_v0" | "bradley_terry_v1";

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
    createdAt: now,
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
    { spec, topK: opts.topK ?? spec.topK },
    { people: people.map((p) => p.id), referrals },
    outputs,
    now,
  );
}

/** Relative Capability Estimates for everyone, wrapped in a ModelRun. */
export function runCapabilityVectors(
  people: readonly Person[],
  comparisons: readonly Comparison[],
  now: Date,
  opts: CapabilityOptions = {},
): ModelRun<CapabilityRun> {
  const spec: ModelSpec = opts.spec ?? CURRENT_SPECS.bradley_terry;
  const outputs = computeCapabilityVectors(people, comparisons, opts);
  const { previous, ...rest } = opts;
  return createModelRun(
    "bradley_terry_v1",
    spec.version,
    {
      spec,
      ...rest,
      minComparisons: outputs.options.minComparisons,
      minOpponents: outputs.options.minOpponents,
      tieHandling: outputs.options.tieHandling,
      anchored: previous !== undefined,
    },
    { people: people.map((p) => p.id), comparisons },
    outputs,
    now,
  );
}
