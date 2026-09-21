/**
 * `runCareerEvidence` — the career-evidence derivation as a `ModelRun`.
 *
 * The run wraps the *derivation*, not the HTTP call. Its `inputHash` is over
 * the sorted ids of the judgment records the claims and events were derived
 * from — the raw observations — and its `parameters` carry the full
 * `CareerEvidenceSpec`, so two runs differ in id exactly when the records or
 * the rubric differ. Re-running the derivation over records already stored is
 * then a cache hit by construction, and a spec whose thresholds moved
 * re-derives without re-billing a single judgment.
 *
 * This is the *only* free path for a spec bump. `processEvidence` keys its
 * judgment store by request fingerprint, and the spec id — version included —
 * is inside that fingerprint, so re-running the pipeline under a new version
 * re-bills even when nothing the model is asked has changed. Derive here
 * instead, from the records that run returned.
 *
 * `defineModel` is a leaf (`src/models/define.ts` imports only `run.ts` and
 * `spec.ts`), so this module honours the longitudinal boundary: no registry,
 * no definitions, no scoring, inference or judge code.
 *
 * Deliberately NOT re-exported from `src/index.ts`. `defineModel` registers
 * process-wide, and the barrel's registry is pinned to the three shipped
 * models (`tests/defineModelRegistry.test.ts`): the career-evidence model is
 * imported by the pipeline's caller, like a model defined in a test file.
 */

import { defineModel, runModel } from "../models/define.ts";
import type { ModelRun } from "../models/run.ts";
import type { CareerEvidenceSpec } from "../models/spec.ts";
import type { DeriveEvidenceInput, ProcessEvidenceResult } from "./pipeline.ts";
import { deriveEvidence } from "./pipeline.ts";

/** What one career-evidence derivation produces. */
export type CareerEvidenceOutputs = Omit<ProcessEvidenceResult, "records">;

/** The only option: the rubric the derivation reads. Recorded in full. */
export interface CareerEvidenceOptions {
  spec: CareerEvidenceSpec;
}

export const careerEvidenceModel = defineModel<
  "career_evidence",
  DeriveEvidenceInput,
  CareerEvidenceOptions,
  CareerEvidenceOutputs
>({
  name: "career_evidence_v1",
  kind: "career_evidence",
  specOf: (opts) => opts.spec,
  // Raw observations only: the judgment record ids, sorted, so the same
  // observations in a different order are the same input.
  inputsOf: (input) => input.records.map((record) => record.id).sort(),
  recordedOptionKeys: ["spec"],
  resolveOptions: (spec) => ({ parameters: { spec }, upstream: [] }),
  compute: (input, spec) => deriveEvidence(input, spec),
});

/**
 * Derive claims, events and a snapshot from stored judgment records, and
 * record the derivation.
 *
 * Pure: every judgment it reads is already an observation, so this issues no
 * request of any kind.
 */
export function runCareerEvidence(
  input: DeriveEvidenceInput,
  opts: { spec: CareerEvidenceSpec; now: Date },
): ModelRun<CareerEvidenceOutputs> {
  return runModel(careerEvidenceModel, input, { spec: opts.spec }, opts.now);
}
