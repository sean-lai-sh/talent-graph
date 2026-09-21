/**
 * The pipeline's kind vocabulary — the answer to "is this a kind a pass
 * runs?", and nothing else.
 *
 * Split out of `./advance.ts` (#55 T8) because the callers of that question
 * are not callers of the orchestrator. `scripts/drift-gate.ts` walks a
 * registry diff and asks which moved kinds a drift report could exist for;
 * `src/config.ts` keys the env bridge on the kinds a pass runs. Neither
 * evaluates anything, and importing `advance()` to ask made the CI gate and
 * the config module depend on the whole evaluation graph.
 *
 * This module imports **types only**. Nothing here runs at import time
 * beyond freezing one record, so the import is free at runtime — which is
 * the point. `./advance.ts` re-exports everything below, so an existing
 * `import { isPipelineKind } from ".../pipeline/advance.ts"` keeps working.
 */

import type { CapabilityRun } from "../inference/capabilityVector.ts";
import type { JudgeCalibrationRun } from "../judges/reliability.ts";
import type { ReferralSignalResult } from "../scoring/referralSignal.ts";

/**
 * What each kind's run carries in `outputs` — and, because it is keyed by
 * kind, the list of kinds a pass runs at all. A `ModelSpec` kind can be
 * registered without appearing here: a rubric spec, say, is versioned data
 * the pipeline never evaluates. Nothing keyed on the `ModelSpecKind` union
 * reaches this module, so such a kind is simply not one of ours rather than
 * a hole to index into.
 *
 * This is the one hand-written list of the pipeline's kinds. `PipelineKind`,
 * `LoadedSpecs` (src/config.ts), `DriftReport["kind"]`
 * (src/analysis/drift.ts), `RunOfKind` / `EngineState` (./advance.ts) and
 * `PIPELINE_KINDS` below are all derived from it or checked against it, so
 * adding a kind the pipeline runs is a change here, not a sweep through four
 * parallel unions.
 *
 * The three output types are imported with `import type`, so naming them
 * costs no runtime import: the outputs of a kind are part of what the kind
 * *is*, and splitting them off would have recreated the second hand-written
 * list this interface exists to prevent.
 */
export interface RunOutputs {
  referral_signal: Map<string, ReferralSignalResult>;
  bradley_terry: CapabilityRun;
  judge_reliability: JudgeCalibrationRun;
}

/** The kinds `advance` runs. A subset of `ModelSpecKind`, never all of it. */
export type PipelineKind = keyof RunOutputs;

/**
 * Membership test for `PipelineKind`, written as a total record so that
 * adding a kind to `RunOutputs` without listing it here — or listing one that
 * is not there — is a compile error.
 */
export const PIPELINE_KINDS: Readonly<Record<PipelineKind, true>> = Object.freeze({
  bradley_terry: true,
  judge_reliability: true,
  referral_signal: true,
});

/**
 * Is `kind` one a pass runs? The membership test behind `driftKinds`, exposed
 * because the registry's rules and the pipeline's are not the same rules:
 * `scripts/drift-gate.ts` walks every registered kind for the append-only
 * checks, then has to ask which of them a drift report could exist for.
 */
export function isPipelineKind(kind: string): kind is PipelineKind {
  // Own keys only: `in` would also answer true for prototype names such as
  // "toString", which is not a kind a pass runs.
  return Object.hasOwn(PIPELINE_KINDS, kind);
}
