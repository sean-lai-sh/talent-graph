// Talent Graph — algorithm core public barrel (alphabetical by path).

export * from "./analysis/dashboard.ts";
export * from "./analysis/drift.ts";
// Named, not `export *`: the barrel surface stays what it was before #56 T3,
// when these two lived in ./graph/referralGraph.ts.
export { selectBySignal } from "./analysis/graphSelection.ts";
export * from "./analysis/reviewQueue.ts";
export * from "./analysis/rubricSummary.ts";
export * from "./analysis/underRecognition.ts";
export * from "./config.ts";
export * from "./domain/constants.ts";
export * from "./domain/rank.ts";
export * from "./domain/types.ts";
export * from "./domain/validate.ts";
export * from "./graph/referralGraph.ts";
export * from "./inference/bradleyTerry.ts";
export * from "./inference/capabilityVector.ts";
export * from "./inference/comparisonSelection.ts";
export * from "./inference/components.ts";
export * from "./inference/logistic.ts";
export * from "./inference/percentile.ts";
export * from "./judges/outcomes.ts";
export * from "./judges/reliability.ts";
export * from "./judges/trackRecord.ts";
export * from "./longitudinal/checkpoints.ts";
export * from "./longitudinal/evaluation.ts";
export * from "./longitudinal/judgments.ts";
export * from "./longitudinal/monitor.ts";
export * from "./longitudinal/outcomes.ts";
export * from "./longitudinal/pipeline.ts";
export * from "./longitudinal/provenance.ts";
export * from "./longitudinal/records.ts";
export * from "./longitudinal/scout.ts";
export * from "./longitudinal/types.ts";
export * from "./longitudinal/validate.ts";
export * from "./models/blend.ts";
export * from "./models/careerEvidence.ts";
// The three shipped model definitions and the `ModelRun` record, exported
// from where they live. `./modelRun.ts` used to re-export them into the
// barrel; the shim is gone (#55 T8). The surface is not quite identical:
// `export *` additionally exposes the type `RunRecordInput`, which the shim
// named no export for, and the only names it removes are the shim's own
// deprecated `createModelRun` alias and the `ModelType` alias it forwarded.
export * from "./models/definitions/index.ts";
export * from "./models/registry.ts";
export * from "./models/run.ts";
export * from "./models/snapshot.ts";
export * from "./models/spec.ts";
// #55 T4 — the orchestrator. Named, not `export *`: the barrel adds
// `advance` and what a caller needs to read its result, nothing else.
export {
  type AdvanceOptions,
  type AdvanceResult,
  advance,
  baselineReferralRun,
  type DriftKind,
  driftKinds,
  type EngineState,
  isPipelineKind,
  judgeWeightedReferralRun,
  type Observations,
  type PipelineKind,
  type RunOfKind,
  requireRun,
} from "./pipeline/advance.ts";
// Hashing lives in `src/provenance/` so that wanting a fingerprint does not
// pull in the scoring/inference graph; in the barrel because `./modelRun.ts`
// re-exported it there before #55 T8.
export * from "./provenance/hash.ts";
export * from "./scoring/referralPercentile.ts";
export * from "./scoring/referralSignal.ts";
export * from "./scoring/referralStrength.ts";
export { toEdgeList } from "./scoring/scoredGraph.ts";
export * from "./seed/generate.ts";
export * from "./seed/outcomes.ts";
export * from "./seed/personas.ts";
// Deliberately not exported: the generator-only persona shapes (hidden
// abilities that drive the seed) and the seeded random number helpers (test
// infrastructure). tests/invariants.test.ts checks this stays true.
