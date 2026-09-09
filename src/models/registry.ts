/**
 * Append-only registry of model spec versions.
 *
 * `CURRENT_SPECS` names the version each math function uses when the caller
 * passes no spec. `SPEC_HISTORY` is every version ever shipped, frozen; a
 * historical `ModelRun` can always be reproduced by looking its version up
 * here. Never edit an existing entry — add a new one and a CHANGELOG line
 * (`docs/models/CHANGELOG.md`).
 */

import { EVIDENCE_MULTIPLIER, REFERRAL_WEIGHTS } from "../domain/constants.ts";
import {
  type BradleyTerrySpec,
  type JudgeReliabilitySpec,
  type ModelSpec,
  type ModelSpecKind,
  type ReferralSignalSpec,
  type SpecOfKind,
  specId,
} from "./spec.ts";

/**
 * Recursively freeze a plain object/array graph. `Object.freeze` is shallow,
 * so a registered spec's nested `weights` would otherwise stay mutable and
 * `isRegisteredSpec` (which compares a spec to its registry entry) could not
 * catch the drift. Functions, Dates, Maps and other exotic objects are left
 * alone; specs contain none.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value as object)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** V0 Referral Signal as specified in the MVP prompt (PLAN.md §4). */
export const REFERRAL_SIGNAL_V0_1_0: ReferralSignalSpec = deepFreeze({
  kind: "referral_signal",
  version: "0.1.0",
  weights: { ...REFERRAL_WEIGHTS },
  evidenceMultiplier: { ...EVIDENCE_MULTIPLIER },
  topK: 5,
});

/**
 * V1 Bradley–Terry as specified in PLAN.md §5. λ = 0.1 is a modest default
 * that keeps single-comparison nodes near 0 on the seed data; it is **not**
 * theoretically optimal and has not been tuned against outcomes.
 */
export const BRADLEY_TERRY_V1_0_0: BradleyTerrySpec = deepFreeze({
  kind: "bradley_terry",
  version: "1.0.0",
  regularization: 0.1,
  maxIterations: 500,
  tolerance: 1e-6,
  minComparisons: 3,
  minOpponents: 2,
  tieHandling: "ignore",
  anchorStrength: 0,
});

/**
 * V2 judge calibration, following the white paper's formulas. The prior
 * reliability is 1 so a judge with no evaluated predictions is weighted
 * exactly as in V0/V1; with no outcomes at all, V2 reproduces V0 exactly.
 * η, τ and λ are modest defaults, not tuned.
 */
export const JUDGE_RELIABILITY_V2_0_0: JudgeReliabilitySpec = deepFreeze({
  kind: "judge_reliability",
  version: "2.0.0",
  observationWindowDays: 180,
  learningRate: 0.3,
  errorScale: 4,
  shrinkage: 3,
  priorReliability: 1,
  opportunityBuckets: [1, 2, 3],
  minBucketSize: 2,
  minKindSize: 3,
  opportunityClock: "referral",
  excludeEditedReferrals: true,
  applyBiasCorrection: false,
});

/**
 * V3 slope / scout placeholders. Same numeric V2 fields; V3 keys present
 * with scoutHook off. Registered so later Phase E issues can compute
 * against it. Not current — production math still uses 2.0.0.
 */
export const JUDGE_RELIABILITY_V3_0_0: JudgeReliabilitySpec = deepFreeze({
  kind: "judge_reliability",
  version: "3.0.0",
  observationWindowDays: 180,
  learningRate: 0.3,
  errorScale: 4,
  shrinkage: 3,
  priorReliability: 1,
  opportunityBuckets: [1, 2, 3],
  minBucketSize: 2,
  minKindSize: 3,
  opportunityClock: "referral",
  excludeEditedReferrals: true,
  applyBiasCorrection: false,
  scoutHook: false,
  scoutShrinkage: 3,
  slopeMinGapDays: 90,
});

/** Every spec version ever shipped. Append only. */
export const SPEC_HISTORY: readonly ModelSpec[] = deepFreeze([
  REFERRAL_SIGNAL_V0_1_0,
  BRADLEY_TERRY_V1_0_0,
  JUDGE_RELIABILITY_V2_0_0,
  JUDGE_RELIABILITY_V3_0_0,
]);

/** The version used when a caller does not pass a spec explicitly. */
export const CURRENT_SPECS: { readonly [K in ModelSpecKind]: SpecOfKind<K> } = deepFreeze({
  referral_signal: REFERRAL_SIGNAL_V0_1_0,
  bradley_terry: BRADLEY_TERRY_V1_0_0,
  judge_reliability: JUDGE_RELIABILITY_V2_0_0,
});

/** All known versions of one kind, in registration order. */
export function specVersions(kind: ModelSpecKind): string[] {
  return SPEC_HISTORY.filter((s) => s.kind === kind).map((s) => s.version);
}

/**
 * Look a spec up by kind and version. Throws on an unknown version, listing
 * the ones that exist, so a typo in a script fails loudly rather than
 * silently falling back to the current spec.
 */
export function getSpec<K extends ModelSpecKind>(kind: K, version: string): SpecOfKind<K> {
  const found = SPEC_HISTORY.find((s) => s.kind === kind && s.version === version);
  if (found === undefined) {
    const known = specVersions(kind);
    throw new Error(
      `unknown spec ${kind}@${version}; known versions: ${known.length ? known.join(", ") : "(none)"}`,
    );
  }
  return found as SpecOfKind<K>;
}

/** True when `spec` is one of the registered versions (by id and by value). */
export function isRegisteredSpec(spec: ModelSpec): boolean {
  const registered = SPEC_HISTORY.find((s) => specId(s) === specId(spec));
  return registered !== undefined && JSON.stringify(registered) === JSON.stringify(spec);
}
