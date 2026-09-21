/**
 * ModelRun — the reproducibility record for every inference run.
 *
 * `parameters` carries the **full** ModelSpec plus every call-site option
 * that can change a number, `inputHash` fingerprints the raw observations,
 * and `upstreamRuns` names every other run whose *output* was consumed, so
 * spec version + hashes + lineage are sufficient to reproduce any historical
 * number exactly.
 *
 * This module knows nothing about scoring or inference: it is the record
 * shape plus the id formula, and nothing else.
 */

import { hashInputs } from "../provenance/hash.ts";
import type { ModelSpecKind } from "./spec.ts";

/**
 * Version of the run id formula. Bumped to 2 when the `+judge_reliability`
 * version tag was replaced by explicit lineage: ids of format 1 are not
 * comparable to ids of format 2 (see `docs/models/CHANGELOG.md` and
 * `tests/fixtures/run-ids-format2-mapping.json`).
 */
export const RUN_ID_FORMAT = 2;

/**
 * How an upstream run's output entered this one.
 *
 * `anchor` — the previous capability fit an anchored refit was pulled toward.
 * `judge_weights` — the calibration whose reliability/bias weights a Referral
 * Signal run applied.
 *
 * Both are the same mechanism: values produced by another run, consumed here.
 */
export type UpstreamRole = "anchor" | "judge_weights";

/** A run this run was computed from. */
export interface UpstreamRun {
  role: UpstreamRole;
  /**
   * The producing run's id, or `null` when the caller consumed the values
   * without naming the run they came from. Never a placeholder id: an
   * unknown producer is recorded as unknown, and the `digest` still pins
   * exactly which values were used.
   */
  runId: string | null;
  /** Hash of the *values* consumed (θ map, weight maps), not of the whole run. */
  digest: string;
}

export interface ModelRun<TOut = unknown> {
  id: string;
  /** Was `modelType` under run id format 1. One naming scheme, shared with ModelSpec. */
  kind: ModelSpecKind;
  /** Always resolvable by `getSpec()`, or a `+env` tag. Never a composed tag. */
  specVersion: string;
  /** Always includes `spec: ModelSpec` plus any call-site options. */
  parameters: Record<string, unknown>;
  inputHash: string;
  /** Empty for a run with no upstream; the key is always present. */
  upstreamRuns: readonly UpstreamRun[];
  createdAt: Date;
  outputs: TOut;
}

/** Everything `createRun` needs. An object, because order would not read. */
export interface RunRecordInput<TOut> {
  kind: ModelSpecKind;
  /**
   * The definition's registry name. Two definitions can share a spec kind
   * and differ only in their maths, so the kind alone does not identify what
   * produced a number.
   */
  model: string;
  specVersion: string;
  parameters: Record<string, unknown>;
  /** Raw observations; hashed into `inputHash`. */
  inputs: unknown;
  outputs: TOut;
  now: Date;
  /** Defaults to none. */
  upstreamRuns?: readonly UpstreamRun[];
}

/**
 * Build a run record and its id.
 *
 * The id formula (RUN_ID_FORMAT 2) is
 *
 *     `${kind}/${model}@${specVersion}:${inputHash.slice(0, 12)}:${paramHash.slice(0, 8)}`
 *
 *   * `kind` is the ModelSpec kind, so `getSpec(kind, specVersion)` resolves
 *     the exact spec that produced the numbers;
 *   * `model` is the definition name, so two definitions of the same kind
 *     that differ only in their `compute` can never share an id;
 *   * `inputHash` fingerprints the raw observations;
 *   * `paramHash = hashInputs({ parameters, upstreamRuns })`, so a different
 *     upstream *run id* moves the id even when the consumed values are
 *     byte-identical.
 *
 * Every component is readable back off the id, so nothing the id depends on
 * is lost. It is part of the stored record format: changing it invalidates
 * every id ever written, so it changes only with a deliberate
 * `RUN_ID_FORMAT` bump.
 */
export function createRun<TOut>(input: RunRecordInput<TOut>): ModelRun<TOut> {
  const { kind, model, specVersion, parameters, outputs, now } = input;
  const inputHash = hashInputs(input.inputs);
  // Copied entry by entry, not just the array: freezing the array alone left
  // each `{ role, runId, digest }` the caller's, so setting `runId` after the
  // fact rewrote `run.upstreamRuns` while `run.id` — hashed from the old
  // value — stayed put. Only the three recorded fields are carried over, so
  // nothing outside the record shape can ride along into the hash.
  const upstream: readonly UpstreamRun[] = Object.freeze(
    (input.upstreamRuns ?? []).map((u) =>
      Object.freeze({ role: u.role, runId: u.runId, digest: u.digest }),
    ),
  );
  const paramHash = hashInputs({ parameters, upstreamRuns: upstream }).slice(0, 8);
  return {
    id: `${kind}/${model}@${specVersion}:${inputHash.slice(0, 12)}:${paramHash}`,
    kind,
    specVersion,
    parameters,
    inputHash,
    upstreamRuns: upstream,
    // A Date is mutable even inside a frozen record; never retain the caller's.
    createdAt: new Date(now.getTime()),
    outputs,
  };
}
