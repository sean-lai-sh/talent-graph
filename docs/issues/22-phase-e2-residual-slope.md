# E2: Causal ΔR* between two cutoffs

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/22

**Phase E · wave 2 · depends on: #20**

## Goal
Pure function that returns `ResidualSlope` for a person between two time
cutoffs, using the existing causal residual machinery in
`src/judges/outcomes.ts`. Undefined states are first-class. No scout math.
No comparison synthesis.

```
ΔR*_v = R*_v(t1) − R*_v(t0)
```

`R*` at a cutoff is the person-level residual from `residualOutcomes` (or the
same cohort builder) evaluated at that cutoff — **not** a new residual
definition. If the person has no defined residual at `t0` or `t1`, `delta`
is `null` and `state` says which side failed.

## States
- `defined` — both residuals exist and `t1 − t0 ≥ slopeMinGapDays`
- `insufficient_early` — no residual at `t0`
- `insufficient_late` — residual at `t0`, none at `t1`
- `undefined_window` — `t1 <= t0`, or gap < `slopeMinGapDays` from the spec

Read `slopeMinGapDays` from the passed spec; if absent (2.0.0), default 90
without mutating the spec.

## Files
- `src/judges/slope.ts` — `residualSlope({ personId, outcomes, opportunities, t0, t1, spec?, now? })`
  and `residualSlopes(...)` for a list of people. `now` is unused for the
  math (cutoffs are `t0`/`t1`) but may be accepted for API symmetry; do not
  read `Date.now()`.
- Reuse `buildOutcomeCohort` / `residualOutcomes` at each cutoff.
- Export from `src/index.ts` via `export * from "./judges/slope.ts"`.
- `tests/slope.test.ts`

## Tests
- Same residual at both cutoffs ⇒ `delta === 0`, `state: "defined"`.
- Residual rises ⇒ positive delta; falls ⇒ negative.
- No outcomes by `t0` ⇒ `insufficient_early`.
- Outcomes only after `t1` ⇒ `insufficient_late` or `insufficient_early`
  as appropriate (document the chosen rule and test it).
- `t1 < t0` or gap too small ⇒ `undefined_window`, `delta: null`.
- Pure: no clock reads. `src/judges` still does not import `src/inference`.

## Do not
- Add `ΔR*` into `p̂_u`, `R_uv`, or capability `θ`.
- Synthesize comparisons from outcomes.
- Implement `Ĝ_u` or `scoutHook`.
- Change `CURRENT_SPECS`.
