# E5: Scout information gain Ĝ_u (second judge number)

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/24

**Phase E · wave 3 · depends on: #22, #21**

## Goal
Compute a **second** judge estimate, scout information gain `Ĝ_u`, reported
next to `p̂_u`. Do not add it to reliability. Do not apply it to Referral
Signal (that's #26).

```
π_v(t_uv) = unweighted V0 Referral Signal of v from referrals with createdAt < t_uv,
            excluding judge u (missing signal ⇒ π = 0)
IG_uv     = (1 − π_v(t_uv)) · max(ΔR*_v, 0)
            only if the referral's forecastKind === "will_compound"
            and ΔR*_v is defined; else skip (not a zero)
Ĝ_u       = shrink mean(IG_uv) toward 0 with λ_g = spec.scoutShrinkage (default 3)
            same n/(n+λ) form as reliability, prior 0
```

`x_uv` must not appear. A modest `will_compound` referral on a person who
then compounds is a hit even if intensity calibration (`p̂_u`) looks poor.

This is a V3 interpretation of the paper's "Reward Information Gain" section,
not a literal implementation of `|R* − R̂^{-u}| × Accuracy`. Document that
in the module comment. Accuracy is omitted on purpose (it would reintroduce
intensity). Slope replaces level so "already strong, flat" is not a scout hit.

## Eligibility
- `forecastKind === "will_compound"` only.
- `unspecified` / missing: never scout-eligible (V2 intensity only).
- Need a defined `ResidualSlope` for `v` on a window the spec defines
  (recommend: `t0 = createdAt`, `t1 = createdAt + max(observationWindowDays,
  slopeMinGapDays)` or two explicit caller cutoffs; pick one rule, document,
  test). If slope is not `defined`, skip.

## Files
- `src/judges/scout.ts` — `computeScoutInformationGain`, `scoreScoutPredictions`
- Extend `computeJudgeCalibration` **optionally** to attach `scout: Map<…>`
  without changing existing reliability numbers.
- `tests/scout.test.ts`
- Export from the barrel.

## Tests
- Unspecified referrals ⇒ judge `gain === 0` / prior, no IG rows.
- `will_compound` + positive ΔR* + π = 0 ⇒ IG = ΔR*.
- π = 1 ⇒ IG = 0 even if slope is huge.
- Negative ΔR* ⇒ IG = 0 (`max(·,0)`).
- `x_uv` / conviction does not change IG (same slope, different intensity).
- Shrinkage: 1 hit vs 5 hits, closed-form `n/(n+λ)`.
- Reliability `p̂_u` on the same run is unchanged from V2.
- `src/judges` still does not import `src/inference`.

## Do not
- Add slope to intercept / add Ĝ to p̂.
- Grade judges by θ or by agreement.
- Flip `scoutHook` or change `CURRENT_SPECS`.
- Let `p̂_u` enter `π_v` (prior is unweighted V0).
