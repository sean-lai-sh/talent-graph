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
import { recordContent } from "./records.ts";

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
  // Every raw input the derivation reads, and nothing else.
  //
  // The record *ids* are not enough: an id names a request, so two runs whose
  // models answered the same question differently carry the same ids and would
  // collide on one run id. The full content of each record is hashed instead,
  // sorted by id so the same observations in a different order are the same
  // input. The window, the person, the evidence and the pipeline version are
  // read by `deriveEvidence` too, so they are inputs as much as the answers
  // are; evidence is sorted by source id for the same order-independence.
  inputsOf: (input) => ({
    identity: input.identity,
    evidence: [...input.evidence].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    baselineAt: input.baselineAt?.toISOString() ?? null,
    cutoffAt: input.cutoffAt.toISOString(),
    retrievedAt: input.retrievedAt.toISOString(),
    pipelineVersion: input.pipelineVersion,
    records: [...input.records]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((record) => recordContent(record)),
  }),
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
