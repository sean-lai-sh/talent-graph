# Durable model updates: versioned specs, drift report, anchored refits, blending

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/15

**Cross-cutting (major) · depends on: #2, #5, #10**

## Problem
Weights (`0.5/0.3/0.2`, evidence multipliers, λ, thresholds) and even the model form will change as the theory matures. A graph that has accumulated months of referrals and comparisons, and real decisions made on its scores, must not be "rebuilt" in a way that silently reshuffles everyone. We need to change the approach without destroying continuity.

## Principles (encode these; do not invent more theory)
1. **Raw observations are immutable and sufficient.** Referrals / Evaluations / Comparisons are never rewritten. Every score is *derived* and reproducible from raw data + a spec. Recomputation is cheap; **semantic drift** is the real cost.
2. **Models are versioned data, not constants.** Weights live in a `ModelSpec` object with a semver, not in hard-coded numbers scattered through functions.
3. **Every run is recorded** (`ModelRun`, #10) with spec version + parameters + input hash, so any historical number can be reproduced exactly.
4. **Changes are measured before they are shown.** A drift report compares old vs new runs on the same data and gates the change.
5. **Transitions are gradual and explainable**: warm-start / anchoring for inference, optional blending for display, and decision snapshots so past decisions keep their provenance.

## Files
### `src/models/spec.ts`
```ts
export interface ReferralSignalSpec { kind: "referral_signal"; version: string /* semver, "0.1.0" */;
  weights: { conviction: number; confidence: number; relationshipDepth: number } /* must sum to 1 */;
  evidenceMultiplier: Record<EvidenceType, number>; topK: number; }
export interface BradleyTerrySpec { kind: "bradley_terry"; version: string;
  regularization: number; maxIterations: number; tolerance: number; minComparisons: number; minOpponents: number;
  tieHandling: "ignore" | "half"; anchorStrength: number /* κ ≥ 0, default 0 */; }
export type ModelSpec = ReferralSignalSpec | BradleyTerrySpec;
export function validateSpec(spec: ModelSpec): { ok: true } | { ok: false; errors: string[] }
```
### `src/models/registry.ts`
- `CURRENT_SPECS = { referral_signal: REFERRAL_SIGNAL_V0_1_0, bradley_terry: BRADLEY_TERRY_V1_0_0 }` and a frozen `SPEC_HISTORY: ModelSpec[]` (append-only). Constants in `src/domain/constants.ts` (#1) become the *values inside* `REFERRAL_SIGNAL_V0_1_0` and are re-exported from there for backwards compatibility.
- `getSpec(kind, version)`; unknown version ⇒ error listing known versions.
- Refactor: `computeReferralSignal(..., { spec? })` (#2) and `fitBradleyTerry / computeCapabilityVectors(..., { spec? })` (#5, #6) accept a spec; defaults to `CURRENT_SPECS`. No math function may read weights from anywhere else.
- `docs/models/CHANGELOG.md` — one entry per spec version: what changed, why, drift report summary, PR link. PR template checkbox (#13): "Weight/model change ⇒ new spec version + CHANGELOG entry + drift report attached."

### Anchored refit (extend #5)
Optional per-person prior centred on the previous run instead of 0:
```
L(θ) = −Σ logσ(θ_w − θ_l) + λ Σ θ_i² + κ Σ_{i ∈ anchored} (θ_i − θ_i^prev)²
```
`fitBradleyTerry(..., { anchor?: { theta: Map<string, number>; strength: κ } })`. `κ = 0` reproduces the plain fit exactly. Also use `θ^prev` as the **initialisation** even when κ = 0 (warm start ⇒ deterministic, stable tie-breaking across runs). Keep zero-mean normalisation per component after fitting; document that anchoring is an engineering continuity device, not part of the theory in `docs/theory/main.tex`.

### `src/analysis/drift.ts`
```ts
export interface DriftReport { kind: "referral_signal" | "bradley_terry"; dimension?: Dimension;
  n: number; spearman: number; kendallTau: number; topKJaccard: Record<10 | 25, number>;
  maxAbsShift: number; meanAbsShift: number; p95AbsShift: number;
  crossedInsufficiency: { gained: string[]; lost: string[] };
  largestMovers: Array<{ personId: string; before: number | null; after: number | null; delta: number }>; /* 10 */
  verdict: "stable" | "review" | "breaking"; thresholds: DriftThresholds; }
export interface DriftThresholds { minKendallTau: number /* 0.9 */; minTop10Jaccard: number /* 0.7 */; maxP95Shift: number /* 10 percentile pts */ }
export function referralSignalDrift(before: Map<string, ReferralSignalResult>, after: Map<…>, t?: DriftThresholds): DriftReport
export function capabilityDrift(before: CapabilityRun, after: CapabilityRun, dimension: Dimension, t?: DriftThresholds): DriftReport
export function formatDriftReport(r: DriftReport): string
```
Compare on the *same* input data; percentile-space for capability, `signal` for referral. `verdict`: `stable` if all thresholds pass, `breaking` if τ < 0.7 or top-10 Jaccard < 0.4, else `review`. Thresholds are defaults, documented as heuristics.

### `src/models/blend.ts`
```ts
export function blendRuns(before: Map<string, number | null>, after: Map<string, number | null>, alpha: number): Map<string, number | null>
export function alphaSchedule(kind: "linear" | "byObservations", p: { start: Date; end?: Date; now: Date; newObservationsSince?: number; saturationCount?: number }): number
```
α=0 ⇒ before, α=1 ⇒ after; `null` on either side ⇒ `null` (missing ≠ low). Blending is for *display continuity during rollout only*; both underlying `ModelRun`s are kept. Note in README that blended values must be labelled as such.

### `src/models/snapshot.ts`
`createPredictionSnapshot({ personId, modelRunIds, values, decision?, now })` populates the `PredictionSnapshot` placeholder (#1): freezes the numbers a decision was made on so later spec versions never rewrite history.

### `scripts/drift.ts`
`bun run drift -- --before <specVersion> --after <specVersion>` on the seed dataset; prints `formatDriftReport`. CI (optional, `continue-on-error`) runs it whenever `src/models/registry.ts` changes and posts the report as a PR comment.

## Tests — `tests/spec.test.ts`, `tests/drift.test.ts`, `tests/blend.test.ts`, extend `tests/bradleyTerry.test.ts`
- `validateSpec` rejects weights not summing to 1, negative λ, unknown evidence type.
- Same spec ⇒ `DriftReport` τ = 1, Jaccard = 1, verdict `stable`.
- Perturbing referral weights to `0.45/0.35/0.2` on seed ⇒ verdict `stable` or `review`, never `breaking` (documents that small tweaks are safe).
- Swapping to `0.2/0.3/0.5` ⇒ verdict `review` or `breaking` and `largestMovers` non-empty.
- Anchored BT: with κ = 10 and one new comparison, new θ within 0.1 of previous; κ = 0 equals plain fit exactly; warm start yields identical θ to cold start (within tolerance) on the seed.
- Blend α ∈ {0, 0.5, 1}; `null` propagation.
- Snapshot values unchanged after re-running with a different spec.

## Do not
- Mutate raw observation records in any migration.
- Store any score on `Person`.
- Let anchoring or blending leak into `docs/theory/main.tex` as theory; document it in README under "Operational continuity".
