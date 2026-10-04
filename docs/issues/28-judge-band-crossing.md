# Judge weights move on grade-band crossings (replaces Phase E)

**Replaces:** #20–#27 (Phase E). That work was merged into `cursor/judge-calibration-demo-5d70` and never reached `main`. It is not ported.
**Builds on:** V2 judge calibration (`judge_reliability@2.0.0`, `src/judges/reliability.ts`) and the Jev person rollup (`src/longitudinal/personRollup.ts`).
**Spec version touched:** registers `judge_reliability@3.0.0`. It becomes current only after a drift report is reviewed.

## Problem

A judge's weight today is one number, `p̂_u`, learned from how close each referral's strength `x_uv` landed to the candidate's outcome percentile. Two things are missing:

1. **Later change is ignored.** A referral is scored once, in a window after it is made. If the candidate moves up or down a level much later, the judge who backed them is never credited or penalised.
2. **One weight covers every kind of candidate.** A judge who reliably spots strong engineers gets the same weight on a GTM or founder pick.

Phase E tried to fix (1) with a second, separate "scout" number. It used a fixed slope window, counted only referrals tagged "will grow", ignored drops, and was off by default. This spec replaces that design.

## Design

### 1. Grade bands are the noise threshold

A candidate's current level maps to an ordered band ladder (for example C, B−, B, B+, A−, A). Movement inside a band is noise and does nothing. Only a **band crossing** counts.

- `band(v, t)`: the band of candidate `v` at time `t`, from the Jev rollup.
- Hysteresis: to enter a new band, the score must clear the band edge by a margin `h`. A score sitting on an edge does not flap.
- Undefined level (no output evidence) means no band. That is "missing", not "lowest band". Missing never becomes low.

### 2. Every referral counts from the start

All referrals count. Committee or admin notes do not. There is no "will grow" tag and no opt-in. One prediction per (judge, candidate) pair, the earliest referral, matching `validateReferral`.

### 3. The update rule

For each scored referral `u → v` made at `t_uv`:

```
Δband_uv(T) = band(v, T) − band(v, t_uv)        // integer number of bands crossed; latest state, not cumulative
```

- If `band(v, t_uv)` is undefined, the baseline is the first defined band after `t_uv`.
- `Δband = 0` gives no update. Inside-band drift is ignored by construction.
- Upward crossings raise the judge's weight. Downward crossings lower it, with the same magnitude per band.
- The adjustment is recomputed from the **latest** band every time Jev updates. It is never accumulated, so a candidate who rises and then falls back to the start nets to zero. Recomputing on the same data gives the same weights.

The judge weight combines V2 accuracy and the crossing term into one number, with no separate scout number:

```
w_u = shrink( p_u · exp(κ · mean_v Δband_uv) )      // κ in the spec; mean over the judge's scored referrals
```

The exact combination (multiplicative as above, or additive in log space) is decided in implementation with a drift report. The constraint: with `κ = 0`, the result is bit-for-bit V2.

### 4. Per-role weights that fall back to the judge's overall weight

Each candidate has a role mix `E_v ∈ Δ^K` over roles (for example `<eng, design, gtm, founder>`), taken from Jev job and claim data. A referral's crossing is credited to role `k` in proportion to `E_v[k]`.

```
w_{u,k} = n_{u,k}/(n_{u,k}+λ) · ŵ_{u,k}  +  λ/(n_{u,k}+λ) · w_u
```

- `n_{u,k}`: the judge's role-weighted referral count in role `k`.
- The fallback target is the judge's **overall** weight `w_u`, not a constant. With little data, per-role equals the single weight, so per-role adds no behaviour until there is data.
- Referral Signal uses `w_{u,k}` with `k` weighted by the candidate's `E_v`.

### 5. What is dropped from Phase E

| Phase E piece | Why it is dropped |
|---|---|
| Separate scout number `Ĝ_u` | Upward crossings already reward early spotting |
| `forecastKind: "will_compound"` tag | Every referral counts |
| Prior-recognition discount `(1 − π_v)` | An A-band candidate has little room to cross upward, so the bands do this work |
| Fixed `t0`/`t1` slope window, `minGapDays` | Recomputed on every update from the latest band |
| Upside-only `max(ΔR*, 0)` | Drops are symmetric |
| Surprise term in comparison selection, trajectory reporting | They do not move a judge's weight. Can return separately |

## Delivery order

1. **Band ladder.** Define band edges and `h` on the Jev rollup. Pure function plus tests. No weight changes.
2. **Crossing term on the single weight.** Register `judge_reliability@3.0.0` with `κ`, `h`, and the ladder. Attach a drift report on the seed. Not current until reviewed.
3. **Per-role split.** Role mix `E_v` from Jev, and `w_{u,k}` with the fallback above. Its own spec bump and drift report.

Each step is its own PR, verifiable on its own.

## Invariants (tests)

- `κ = 0` gives V2 exactly. Golden run ids unchanged.
- Inside-band movement never changes any weight.
- A candidate who rises and then returns to their starting band leaves the judge's weight unchanged.
- An undefined band never produces an update. Missing is not low.
- Per-role weights equal `w_u` when `n_{u,k} = 0`.
- The circularity guard holds. Truth comes from outcomes and Jev evidence, never from V1 capability estimates built from the same judges' comparisons (`src/judges` never imports `src/inference`).
- There is no merged person score. Judge weights stay hidden in the UI.

## Open questions

1. **Which quantity the bands sit on:** Jev `value`, `substance`, or `alpha`. Alpha is a residual (the surprise relative to expectation), so a band on alpha means "outperforming expectation". A band on value means "level". The "B player becomes B+" example reads as level.
2. **Band edges:** fixed cut points, or club percentiles. Percentiles shift as the club grows, which moves bands without the candidate changing.
3. **Time between referral and crossing:** should a crossing that happens years later count fully, or decay?
4. **Gaming:** a judge can refer many people with low evidence and wait for a few to cross. A symmetric penalty partly limits this, and the clique case is assumed out of scope for now.
5. **Referral-volume signal** (many referrals plus passing evaluations means the name is spreading). This is a candidate signal, not a judge weight, and is tracked separately.
