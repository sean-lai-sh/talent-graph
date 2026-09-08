# Bradley–Terry fit: regularised, normalised, per component, per dimension

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/5

**Phase C · depends on: #4**

## Goal
The core V1 inference module. Transparent numerical code, no ML deps, heavily commented.

## Math
```
P(i ≻ j) = σ(θ_i − θ_j)
L(θ)     = − Σ_{(w,l)∈C} logσ(θ_w − θ_l) + λ Σ_i θ_i²
∇_i L    = − Σ_{(w,l): w=i} σ(θ_l − θ_w) + Σ_{(w,l): l=i} σ(θ_w − θ_l) + 2λθ_i
```
After convergence: `θ ← θ − mean(θ)` **within each connected component** (translation invariance holds per component only).

## API — `src/inference/bradleyTerry.ts`
```ts
export interface ComparisonObservation { winnerId: string; loserId: string; weight?: number /* default 1; 0.5 for tie halves */ }
export interface BradleyTerryOptions { regularization?: number /* λ, default config.btRegularization = 0.1 */; maxIterations?: number /* 500 */; tolerance?: number /* 1e-6 on ‖∇‖∞ */; stepSize?: number /* initial, 0.5, with backtracking */ }
export interface BradleyTerryFit {
  personId: string; theta: number; comparisonCount: number; opponentCount: number;
  wins: number; losses: number; componentId: string; componentSize: number;
}
export interface BradleyTerryRun { fits: BradleyTerryFit[]; iterations: number; converged: boolean; finalGradientNorm: number; negLogLik: number; options: Required<BradleyTerryOptions>; }
export function fitBradleyTerry(personIds: string[], observations: ComparisonObservation[], options?: BradleyTerryOptions): BradleyTerryRun
export function toObservations(comparisons: Comparison[], dimension: Dimension, opts?: { tieHandling?: "ignore" | "half" }): ComparisonObservation[]
```
- Solver: gradient descent with Armijo backtracking on L, or diagonal-Newton step `θ_i −= g_i / (h_i + 2λ)` with `h_i = Σ σ(1−σ)` over i's comparisons. Either is fine; pick one, comment it, and note the choice in README.
- Run the fit per connected component (use #4) so unrelated groups never influence each other; concatenate results.
- `theta` for a person with zero observations is exactly `0` (their own singleton component).
- Never produce NaN/Infinity: use `logSigmoid` everywhere; assert finiteness in a debug check.
- Percentiles are NOT computed here (see #6).

## Tests — `tests/bradleyTerry.test.ts` (the 8 mandated + extras)
1. A beats B ×10 ⇒ `θ_A > θ_B`.
2. A>B ×10, B>C ×10 ⇒ `θ_A > θ_B > θ_C`.
3. A>B ×5, B>A ×5 ⇒ `|θ_A − θ_B| < 1e-6`.
4. Mean of θ within each component ≈ 0 (|mean| < 1e-9); adding a constant to θ leaves every predicted probability unchanged (test `sigmoid` of differences).
5. Node D with 1 win vs A (A has 30 comparisons elsewhere) has `|θ_D|` smaller than it would with λ=0.001 (shrinkage monotone in λ).
6. Two disjoint groups ⇒ two distinct `componentId`s; fitting the union equals fitting each separately (θ within 1e-6).
7. A>B ×2 vs A>B ×40 ⇒ gap grows with more data (with fixed λ).
8. A>B ×1000 with λ=1e-9 ⇒ all θ finite, no NaN, `converged` or hit `maxIterations` gracefully.
Extras: `toObservations` drops `skip`/`insufficient_observation`; `tieHandling:"half"` emits two 0.5-weight observations; `tieHandling:"ignore"` emits none; `wins+losses === comparisonCount`.

## Do not
- Use `confidence` in the likelihood (store-only in V1).
- Learn any per-evaluator weight.
- Import from `src/scoring/`.


## Update-mechanism note (see #15)
Accept an optional `anchor: { theta: Map<string, number>; strength: number }` (prior centred on a previous run, κ·Σ(θ_i − θ_i^prev)²) and use previous θ as the warm-start initialisation. κ = 0 must reproduce the plain fit exactly.
