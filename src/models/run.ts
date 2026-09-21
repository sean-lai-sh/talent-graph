/**
 * ModelRun — the reproducibility record for every inference run.
 *
 * `parameters` carries the **full** ModelSpec (kind, version, every weight),
 * and `inputHash` fingerprints the raw observations, so spec version + hash
 * are sufficient to reproduce any historical number exactly.
 *
 * This module knows nothing about scoring or inference: it is the record
 * shape plus the id formula, and nothing else.
 */

import { hashInputs } from "../provenance/hash.ts";

export type ModelType = "referral_signal_v0" | "bradley_terry_v1" | "judge_reliability_v2";

/**
 * A run this run was computed from — e.g. the previous capability fit an
 * anchored refit was pulled toward, or the calibration whose weights a
 * Referral Signal run used. Recorded by role so lineage reads as a graph
 * rather than a bag of ids.
 */
export interface UpstreamRun {
  /** The option the upstream run arrived as, e.g. "previous". */
  role: string;
  /** The upstream `ModelRun.id`, or null when the caller did not supply one. */
  runId: string | null;
}

/** Every upstream run that fed one run. */
export interface RunLineage {
  upstream: readonly UpstreamRun[];
}

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

/**
 * Build a run record and its id.
 *
 * The id formula is `type@version:inputHash[0..12]:paramHash[0..8]` and is
 * part of the stored record format: changing it invalidates every id ever
 * written, so it changes only with a deliberate run-id format bump.
 *
 * `lineage` is recorded by the generic runner but does not yet reach the
 * emitted record or the id; that lands with the format bump.
 */
export function createRun<TOut>(
  modelType: ModelType,
  modelVersion: string,
  parameters: Record<string, unknown>,
  inputs: unknown,
  outputs: TOut,
  now: Date,
  _lineage: RunLineage = { upstream: [] },
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
