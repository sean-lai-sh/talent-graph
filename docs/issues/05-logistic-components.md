# Numerically stable logistic helpers + per-dimension connected components

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/4

**Phase C · depends on: #1**

## Goal
Two small pure modules the Bradley–Terry fit relies on.

## `src/inference/logistic.ts`
```ts
export function sigmoid(x: number): number         // 1/(1+e^-x), branch on sign to avoid overflow
export function logSigmoid(x: number): number      // x<0 ? x - Math.log1p(Math.exp(x)) : -Math.log1p(Math.exp(-x))
export function log1pExp(x: number): number        // softplus, stable for |x| > 700
```
Document why naive `Math.log(1/(1+Math.exp(-x)))` fails for x ≈ −800.

## `src/inference/components.ts`
Build, per dimension, the undirected graph where an edge exists iff two people have at least one comparison on that dimension with outcome `"a"` or `"b"` (ties count as edges too when `tieHandling === "half"`; `skip`/`insufficient_observation` never create edges).
```ts
export interface ComponentInfo { componentId: string; members: string[]; comparisonCount: number; }
export function comparisonComponents(personIds: string[], comparisons: Comparison[], dimension: Dimension, opts?: { includeTies?: boolean }): { byPerson: Map<string, string>; components: ComponentInfo[] }
```
Use iterative union-find or BFS (no recursion; graphs may be large later). `componentId` = `${dimension}:${smallest member id}` for determinism. People with no comparisons on the dimension form singleton components.

## Tests
- `tests/logistic.test.ts`: `logSigmoid(0) ≈ -ln2`; `logSigmoid(-1000)` is finite and ≈ −1000; `logSigmoid(1000) ≈ 0`; `sigmoid(±1000)` ∈ {0,1} without NaN.
- `tests/components.test.ts`: two disjoint triangles ⇒ 2 components; add one bridging comparison ⇒ 1; a `skip` does not bridge; a person absent from all comparisons is a singleton; components on `taste` don't leak into `agency`.
