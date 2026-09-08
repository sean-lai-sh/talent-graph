# Percentiles, capability vector, insufficient-evidence states, pool confidence

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/6

**Phase C · depends on: #5**

## Goal
Turn raw θ into the display-safe *Relative Capability Estimate*: per-dimension percentiles within the connected pool, with explicit insufficient-evidence states and explanation metadata. Never a single scalar.

## Files
### `src/inference/percentile.ts`
```ts
export function percentileWithin(values: Array<{ id: string; theta: number }>): Map<string, number>
```
Rank-based: `pct = 100 · (rank − 1) / (n − 1)` for n ≥ 2, average ranks on ties, `null`-free (callers filter). For `n === 1` return `50` but callers will mark it insufficient anyway.

### `src/inference/capabilityVector.ts`
```ts
export type DimensionEstimate =
  | { state: "estimated"; dimension; theta: number; percentile: number; comparisonCount; opponentCount; wins; losses; componentId; componentSize; poolComparisonCount; poolConfidence: "low"|"medium"|"high"; recent: Comparison[] /* ≤5 newest involving the person */ }
  | { state: "insufficient_evidence"; dimension; comparisonCount; opponentCount; reason: string };
export interface CapabilityVector { personId: string; dimensions: Record<Dimension, DimensionEstimate>; explanation: string; }
export interface CapabilityRun { vectors: Map<string, CapabilityVector>; runsByDimension: Record<Dimension, BradleyTerryRun>; }
export function computeCapabilityVectors(people: Person[], comparisons: Comparison[], opts?: { minComparisons?: number /* config, 3 */; minOpponents?: number /* 2 */; bt?: BradleyTerryOptions; tieHandling? }): CapabilityRun
```
- Fit each dimension independently via #5 (`toObservations` → `fitBradleyTerry`).
- Percentile computed only among members of the same component who are themselves `estimated`.
- `insufficient_evidence` when `comparisonCount < minComparisons` **or** `opponentCount < minOpponents` **or** component of estimated peers has size < 2. `reason` is human-readable ("2 comparisons; need at least 3").
- `poolConfidence` heuristic (document as heuristic, not theory): `high` if componentSize ≥ 15 and avg comparisons/person ≥ 6; `medium` if componentSize ≥ 6 and avg ≥ 3; else `low`.
- `explanation` fixed text: "This estimate is inferred from pairwise comparisons within the observed network and should not be interpreted as an absolute measure of ability."
- Export a `formatDimensionEstimate(e)` helper returning e.g. `"Estimated percentile: 91st · Comparisons: 18 · Unique opponents: 11"` or `"Insufficient evidence"` (ordinal suffix helper included).

## Tests — `tests/percentile.test.ts`, `tests/capabilityVector.test.ts`
- Percentile of 3 ordered thetas ⇒ 0 / 50 / 100; ties averaged.
- Person with 1 comparison ⇒ `insufficient_evidence` with correct reason.
- Person in a 2-node component vs a 10-node component: percentiles are relative to their own pool.
- Strong on problem_solving but absent from generativity comparisons ⇒ `estimated` on one, `insufficient_evidence` on the other (Candidate F shape).
- No dimension of the vector is ever summed/averaged into a scalar (assert the type has no such field; grep test in #12 covers code).

## Superseded
`poolConfidence` is computed on the **estimated pool** (`poolSize`: members who cleared the evidence thresholds, i.e. the people the percentile is actually relative to), not on `componentSize` as written above; the average comparisons per person is over that same pool. Both `componentSize` and `poolSize` are reported on the estimate. See the doc comment on `poolConfidence` in `src/inference/capabilityVector.ts`.
