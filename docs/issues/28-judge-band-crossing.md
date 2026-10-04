# Judge weights move on grade-band crossings (replaces Phase E)

**Replaces:** #20–#27 (Phase E). That work was merged into `cursor/judge-calibration-demo-5d70` and never reached `main`. It is not ported.
**Builds on:** V2 judge calibration (`judge_reliability@2.0.0`, `src/judges/reliability.ts`) and the Jev claim and rollup modules (`src/longitudinal/claimValue.ts`, `src/longitudinal/personRollup.ts`).
**Spec version touched:** registers `judge_reliability@3.0.0`. It becomes current only after a drift report is reviewed.

## Problem

A judge's weight today is one number, `p̂_u`, learned from how close each referral's strength `x_uv` landed to the candidate's outcome percentile. Two things are missing:

1. **Later change is ignored.** A referral is scored once, in a window after it is made. If the candidate moves up or down a level much later, the judge who backed them is never credited or penalised.
2. **One weight covers every kind of candidate.** A judge who reliably spots strong engineers gets the same weight on a GTM or founder pick.

Phase E tried to fix (1) with a second, separate "scout" number. It used a fixed slope window, counted only referrals tagged "will grow", ignored drops, and was off by default. This spec replaces that design.

## Design

### 1. Bands read evidence only

A judge's weight must never depend on anything the judges themselves produced. Two Jev inputs today break that:

- `personRollup.ts`: `consensus = selectionAggregate + wTrend · trend`, where `trend` is caller-supplied with no provenance.
- `claimValue.ts`: `ReferrerNote`s raise a claim's `backingMultiplier`. A judge could write notes that lift their own candidate's value, push them across a band, and earn weight from it.

So bands read a separate **evidence-only score**, `evidenceScore(v, asOf)`:

- It is produced by its own function, `outputOnlyRollup`, which has **no** `trend` or `notes` parameter. The exclusion is in the type, not in a convention.
- Inputs are resume- and source-derived claims only. Excluded: referrer notes, trend, comparisons, Referral Signal, and anything downstream of judge weights.
- Each run records `outputOnlyRollup`'s config hash as upstream lineage, so the source of every band is on file.

### 2. Band ladder and crossing margin

An ordered ladder of fixed band edges over `evidenceScore` (for example C, B−, B, B+, A−, A). The edges are fixed in the spec, not club percentiles, so a band cannot change when only the club's population changes.

The **crossing margin** `h` is the noise threshold. An edge counts as crossed only when the score is past it by at least `h`:

```
crossed(b0, s) = +#{ edges e above band b0 : s ≥ e + h }
               − #{ edges e below band b0 : s ≤ e − h }
```

This is a pure function of the stored baseline band `b0` and the latest score `s`, with no path history and no hysteresis state. Moving from B to B/B+ never counts. A solid B+ counts as +1.

### 3. Every referral, locked baseline, maturity horizon

All referrals count. Committee or admin notes do not. There is no "will grow" tag. One prediction per (judge, candidate) pair, the earliest referral, matching `validateReferral`.

For each referral `u → v` made at `t_uv`:

- **Baseline snapshot.** `b0_uv` is the band from the latest `evidenceScore` run for `v` at or before `t_uv`. If there is none, it is the band from the first run within the grace period `(t_uv, t_uv + G]` (e.g. `G` = 30 days, covering resume intake). Evidence dated after `t_uv` never sets the baseline when an earlier run exists. It is stored **once** with the referral, together with the rollup config hash and claim set hash that produced it. Later Jev reruns or backfills never rewrite it. Changing a baseline is an explicit correction operation that is logged.
- **Maturity horizon `H`** (e.g. 12 months). A referral enters the judge's average at `t_uv + H` whatever has happened. Before that it is still pending and contributes nothing.
- **Unresolved at maturity.** If there is no baseline, or no score after the baseline, by `t_uv + H`, the referral counts as **0** in the average. It is diluted, not penalised: missing is never low. Admins can see each judge's unresolved rate.

The denominator is every matured referral, so referring many people who never show evidence lowers a judge's mean instead of costing nothing.

### 4. Score each referral against the base rate for its starting band

Raw crossings are not fair on a bounded ladder: an A-band candidate can only go down, and a C-band candidate can mostly only go up. Each referral is scored against the typical movement of candidates who started in the same band:

```
Δ_uv     = crossed(b0_uv, latest evidenceScore(v))         // 0 when unresolved at maturity
base(b)  = mean Δ over all matured club candidates with baseline band b, same horizon
score_uv = Δ_uv − base(b0_uv)                              // unresolved referrals: score_uv = 0
```

- `base(b)` is computed from every candidate with a baseline in band `b`, referred or not. It shrinks toward the pooled mean across all bands when band `b` has fewer than `m` candidates.
- Backing an A who stays an A scores positive if A's typically drift down. Backing a C who rises only as much as C's typically do scores about 0.
- This replaces Phase E's prior-recognition discount `(1 − π_v)` with something measured from the same evidence the bands use.

### 5. The judge weight

One weight per judge. V2 accuracy is adjusted by the crossing term. There is no separate scout number.

```
c_u  = n_u/(n_u + λ_c) · mean_{matured uv} score_uv              // shrunk toward 0
w_u  = p̂_u · exp(κ · c_u)
```

The exact combination (multiplicative as above, or additive in log space) is decided in implementation with a drift report. The constraint: with `κ = 0`, `w_u = p̂_u` exactly.

### 6. Per-role weights that fall back to the judge's overall weight

Each candidate has a role mix `E_v ∈ Δ^K` over roles (for example `<eng, design, gtm, founder>`), taken from Jev job and claim data. A referral's `score_uv` is credited to role `k` in proportion to `E_v[k]`.

```
w_{u,k} = n_{u,k}/(n_{u,k}+λ) · ŵ_{u,k}  +  λ/(n_{u,k}+λ) · w_u
```

- `n_{u,k}`: the judge's role-weighted count of matured referrals in role `k`.
- The fallback target is the judge's **overall** weight `w_u`, not a constant. With little data, per-role equals the single weight, so per-role adds no behaviour until there is data.
- Referral Signal uses `w_{u,k}` with `k` weighted by the candidate's `E_v`.

### 7. What is dropped from Phase E

| Phase E piece | What replaces it |
|---|---|
| Separate scout number `Ĝ_u` | Crossing term inside the single weight (§5) |
| `forecastKind: "will_compound"` tag | Every referral counts (§3) |
| Prior-recognition discount `(1 − π_v)` | Base rate by starting band (§4) |
| Fixed `t0`/`t1` slope window, `minGapDays` | Locked baseline, latest score, maturity horizon (§3) |
| Upside-only `max(ΔR*, 0)` | Symmetric crossings, scored against the base rate (§2, §4) |
| Surprise term in comparison selection, trajectory reporting | Not replaced. They do not move a judge's weight and can return separately |

## Delivery order

Each step is its own PR, verifiable on its own:

1. **Evidence-only rollup and band ladder.** `outputOnlyRollup`, the ladder, `h`, and `crossed`. Pure functions plus tests. No weight changes.
2. **Baseline snapshots.** Store `b0_uv` with its provenance on each referral, plus the logged correction operation. No weight changes.
3. **Crossing term on the single weight.** `H`, `G`, `base(b)`, `c_u`, `κ`. Register `judge_reliability@3.0.0` and attach a drift report on the seed. Not current until reviewed.
4. **Per-role split.** Role mix `E_v` from Jev and `w_{u,k}` with the fallback above. Its own spec bump and drift report.

## Invariants (tests)

- **κ = 0:** V3 output values are bit-for-bit equal to V2's. A V3 run gets its own run id, because run ids hash the spec version and parameters. Runs still on V2 keep their golden ids.
- **No judge-derived input:** adding referrer notes or a `trend` value for a candidate leaves their `evidenceScore` and band unchanged. `outputOnlyRollup` has no parameter that accepts either, enforced by a type test.
- **Lineage:** every band records the `outputOnlyRollup` config hash, and a run whose upstream lineage includes `judge_reliability` or `referral_signal` is rejected.
- **Dead band:** a score inside `[e − h, e + h]` of every edge relative to the baseline never changes any weight.
- **Round trip:** a candidate who rises and then returns to their starting band leaves the judge's weight unchanged.
- **Spam:** a judge with 30 matured referrals, 28 unresolved and 2 rising one band, gets a crossing term no larger than `2/30` of a judge whose 30 referrals all rise one band.
- **Boundary fairness:** two simulated judges with equal skill, one referring only top-band candidates and one only bottom-band candidates, end up with weights within a stated tolerance.
- **Backfill:** rerunning Jev with backdated evidence does not change any stored baseline.
- **Per-role fallback:** `w_{u,k} = w_u` when `n_{u,k} = 0`.
- There is no merged person score. Judge weights stay hidden in the UI.

## Open questions

1. **Which quantity `evidenceScore` is:** evidence-only `value`, `substance`, or `alpha`. Alpha is a residual (outperforming expectation), and value reads as level. The "B player becomes B+" example reads as level.
2. **Band edge values, `h`, `G`, `H`, `m`, and `λ_c`.** They are set from the seed with the drift report in step 3.
3. **Late crossings:** should a crossing years after the referral count fully, or decay?
4. **Base-rate cohort:** whether `base(b)` uses all club candidates or only referred ones. All candidates is the default, because it does not depend on judges.
5. **Referral-volume signal** (many referrals plus passing evaluations means the name is spreading). This is a candidate signal, not a judge weight, and is tracked separately.
