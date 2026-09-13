# E3: Contribution trajectory (reporting only) + sloped seed personas

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/23

**Phase E · wave 3 · depends on: #22**

## Goal
A reporting-only series of residuals / slopes over a list of cutoffs, plus
seed personas whose outcomes actually slope (Cleo compounds; a flat-famous
persona stays high and flat). Nothing here feeds V0/V1 or judge weights.

## Trajectory
`src/judges/trajectory.ts` (name may vary):
```
contributionTrajectory(personId, cutoffs, outcomes, opportunities, spec)
  → { personId, points: Array<{ at, residual, state }>, slopes: ResidualSlope[] }
```
Adjacent cutoffs call `residualSlope`. Presentation only — dashboard / demo
may print it later (#27). No write-back into scoring.

## Seed
Extend `src/seed/outcomes.ts` / persona shapes so:
- **Cleo** (`p-cleo`): low early residual, clearly positive `ΔR*` across the
  demo window (compounds after a quiet start).
- At least one already-strong person (Alice or Bram) stays **high intercept,
  flat slope** (ΔR* ≈ 0).
- Deterministic. Existing V2 judge tests must still pass (or be updated only
  if labels change — prefer shaping outcomes so V2 assertions remain true).

Do **not** set `forecastKind: "will_compound"` on every Cleo referral unless
#21 has already landed; if it has, mark **one** early Cleo referral
`will_compound` and leave others unspecified.

## Tests
- Cleo's `residualSlope` over the seed demo cutoffs is `defined` and `delta > 0`.
- The flat-famous persona has `|delta|` near 0 (tolerance documented).
- Trajectory length is `cutoffs.length` points and `cutoffs.length - 1` slopes.
- Seed remains deterministic (`generateSeed()` twice → equal ids / dates).

## Do not
- Feed trajectory into Referral Signal or Bradley–Terry.
- Import `src/inference` from `src/judges`.
- Make `3.0.0` current.
