# E7: Slope-aware comparison *selection* only

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/25

**Phase E · wave 3 · depends on: #22, #7 (comparison selection)**

## Goal
Let the comparison-selection heuristic take an optional **caller-injected**
surprise / slope term. `src/inference` must not import `src/judges` or
compute residuals. No comparison is synthesized from outcomes.

```
Priority = a·Uncertainty + b·Closeness + c·Novelty + d·Surprise
```
`Surprise` is 0 when the caller passes nothing. When passed, a map
`personId → surprise ∈ [0, 1]` (e.g. normalised `|ΔR*|` or
`(1−π)·max(ΔR*,0)` computed **outside** inference). Pair surprise =
`max(s_i, s_j)` or mean — pick one, document, test. Default `d = 0` so
existing rankings are bit-identical.

## Files
- `src/inference/comparisonSelection.ts` — extend `SelectionOptions`:
  `surprise?: ReadonlyMap<string, number>`, `weights.d?`
- `tests/comparisonSelection.test.ts`
- Do not import slope modules.

## Tests
- No surprise map / `d = 0` ⇒ same order and scores as today (bit-identical
  on the existing fixtures).
- High surprise on one person lifts pairs that include them.
- `src/inference` still does not import `src/scoring` or `src/judges`.
- Surprise values outside [0, 1] are clamped or rejected — pick one and test.

## Do not
- Compute ΔR* inside inference.
- Auto-generate Comparison rows from outcomes.
- Change Bradley–Terry likelihood or capability vectors.
