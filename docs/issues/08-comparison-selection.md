# Comparison selection heuristic

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/7

**Phase C · depends on: #6**

## Goal
Propose informative pairs for an evaluator on a dimension. Heuristic, not optimal; do not over-engineer.

## Math
```
Priority(i,j,k) = a·Uncertainty + b·Closeness + c·Novelty
Uncertainty(i,j) = 1 / (1 + min(n_i, n_j))                 n = comparisonCount on k
Closeness(i,j)   = exp(−|θ_i − θ_j|)  if same component and both estimated
                 = 0.5                 if either is insufficient/unknown (encourage bootstrapping)
                 = 0.5·crossComponentBonus (default 1) if different components (bridging is valuable)
Novelty(i,j)     = 1 if pair never compared on k (by anyone)
                 = 1 / (1 + daysSince(lastComparison)/30)^-1 … simplify: = min(1, daysSince/30)
```
Defaults `a=b=c=1`.

## API — `src/inference/comparisonSelection.ts`
```ts
export interface SelectionOptions { evaluatorId?: string; now: Date; limit?: number /* 10 */; weights?: { a?: number; b?: number; c?: number }; crossComponentBonus?: number; candidatePool?: string[] /* restrict to ids the evaluator has observed */ }
export interface ProposedComparison { personAId: string; personBId: string; dimension: Dimension; priority: number; parts: { uncertainty: number; closeness: number; novelty: number }; prompt: string /* DIMENSION_PROMPTS[k] */ }
export function selectComparisons(dimension: Dimension, run: CapabilityRun, comparisons: Comparison[], opts: SelectionOptions): ProposedComparison[]
```
- Exclude `i === j`, pairs where evaluator is A or B, and pairs outside `candidatePool` when given.
- Deterministic ordering: priority desc, then `(personAId, personBId)` lexicographic with A < B.
- `now` is a parameter; never call `Date.now()` inside.

## Tests — `tests/comparisonSelection.test.ts`
- Never-compared pair outranks a pair compared yesterday, all else equal.
- Close θ pair outranks far θ pair.
- Sparse person appears in top results more than a heavily-compared one.
- Evaluator never proposed against themselves.
- Same inputs ⇒ identical output (determinism).
