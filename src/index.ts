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
export * from "./modelRun.ts";
export * from "./models/blend.ts";
export * from "./models/careerEvidence.ts";
export * from "./models/registry.ts";
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
