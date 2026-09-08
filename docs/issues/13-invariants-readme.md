# Invariant tests + README (math, limitations, roadmap)

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/12

**Closeout · depends on: all**

## `tests/invariants.test.ts`
Static checks over `src/` using `Bun.Glob` + file reads (no runtime magic):
1. No file under `src/scoring/` imports from `src/inference/` and vice versa.
2. Only the explicit meeting points import from both: `src/analysis/underRecognition.ts` (the diagnostic), `src/analysis/dashboard.ts` (presentation), `src/analysis/drift.ts` and `src/modelRun.ts` (bookkeeping), `src/index.ts` (barrel). `scripts/demo.ts` is outside `src/` and not checked.
3. No file under `src/` contains any `BANNED_LANGUAGE` string outside `constants.ts`.
4. No file under `src/scoring/` or `src/inference/` references `affiliation`, `bio`, or `Evaluation`.
5. No file under `src/scoring/` or `src/inference/` calls `Date.now()` or `new Date()` without an argument.
6. `CapabilityVector` type exposes no scalar aggregate field (regex on `capabilityVector.ts` for `overall|total|score:`).

## README.md (replace skeleton from #14)
Sections, in order, each with the exact formulas from PLAN.md §4–§7 rendered as fenced math/text:
1. **What this is** — algorithm core only; how a future app imports it; `bun` commands; Doppler usage.
2. **Product concept** — why Referral Signal ≠ Relative Capability; the five invariants.
3. **V0 model** — `n(x)`, `X_uv`, `m_e`, `R_uv`, `S_v`, `p_u = 1`; metadata shown alongside.
4. **V1 model** — `P(i≻j)=σ(θ_i−θ_j)`, MLE objective, why pairwise beats 1–10 ratings, L2 regularisation (λ default and honesty note), zero-mean normalisation per component, connected components, insufficient-evidence rules, percentile rule, pool-confidence heuristic.
5. **Comparison selection** — priority formula.
6. **Under-recognition gap** — formula + "exploratory" caveat.
7. **Limitations** — judges equally weighted; social correlation ignored; pairwise judgments subjective; no outcome validation; may reflect network bias; estimates relative to observed graph; λ not tuned.
8. **Roadmap** — V2 judge calibration · V3 bias/clique correction · V4 longitudinal outcomes · V5 opportunity correction + exploration; pointer to `docs/theory/main.tex` sections for each.
9. **Theory doc** — note that `docs/theory/main.tex` is canonical and must be updated alongside any theory change (see #13).

## Acceptance
`bun test` green including invariants; README renders on GitHub; no banned language anywhere in `src/` or README prose (README may list them under "avoid").
