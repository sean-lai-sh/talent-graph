# Judge weights from candidate movement (v3.2, replaces Phase E)

**Status:** v3.2 draft for final review. Not implemented. The Linear doc is the source of truth; this file is a copy so Codex can review it as a diff.
**Replaces:** #20–#27 (Phase E). That work was merged into `cursor/judge-calibration-demo-5d70` and never reached `main`. It is not ported.
**Builds on:** V2 judge calibration (`judge_reliability@2.0.0`, `src/judges/reliability.ts`) and the Jev claim and rollup modules (`src/longitudinal/claimValue.ts`, `src/longitudinal/personRollup.ts`).
**Spec version touched:** registers `judge_reliability@3.0.0`. It becomes current only after a drift report is reviewed.

---

## 1. Summary

People in the club refer candidates. Each referrer ("judge") has a **weight**: how much their referrals count. Today that weight is learned once per referral, from how close the judge's rating came to how the candidate turned out shortly after.

This spec makes two changes:

1. **Later movement counts.** If a candidate a judge backed later moves up a level (B → B+) beyond what's normal for where they started, the judge's weight goes up. If the candidate drops, it goes down. Small wobble (B → B/B+) is noise and does nothing.
2. **Weights per role.** A judge good at spotting engineers doesn't get extra weight on GTM picks.

The rules that make this hard to game and stable over time:

- The candidate score it reads is built **only from evidence the judges didn't write**.
- Every value is measured **as of a fixed date and stored once**. Later reruns never move old results.
- Movement is judged **against what's normal for the candidate's starting score**, so picking strong or weak candidates isn't rewarded by itself.
- A judge's average uses **only referrals that moved past the noise threshold**, so padding with extra referrals does nothing.

---

## 2. What exists today (V2)

From `src/judges/reliability.ts`:

```
x_uv     = strength of referral u → v (conviction, confidence, relationship depth, evidence type)
truth_uv = percentile of v's opportunity-corrected outcome residual R*_v, from outcomes after the referral
E_uv     = (x_uv − truth_uv)²
Ē_u     ← (1 − η)·Ē_u + η·E_uv          (chronological)
p_u      = exp(−τ·Ē_u)
p̂_u      = n/(n+λ)·p_u + λ/(n+λ)·μ_p     (shrinkage to the population mean)
b_u      = signed bias, shrunk toward 0
```

- One weight per judge. `JudgeCalibration.dimension` exists but is always `null`.
- One prediction per (judge, candidate) pair: the earliest referral.
- Referral Signal: `contribution = p̂_u · clip(R_uv − b̂_u, 0, 1)`.
- Circularity guard today: `src/judges` never imports `src/inference`.
- Product rules: missing data is never treated as low. No single merged person score. Judge weights are hidden in the UI.

**Jev** is the LLM pipeline that turns a candidate's career claims into claim values, then rolls them up per person into `consensus`, `substance`, `value` and `alpha` (`src/longitudinal/personRollup.ts`). Three inputs come from judges, directly or indirectly:

- `consensus = selectionAggregate + wTrend · trend`, where `trend` is a caller-supplied map with no provenance check.
- `claimValue.ts` accepts `ReferrerNote`s, which raise a claim's `backingMultiplier`.
- Referrer-added claims (SEA-61): accomplishments a referrer adds that the resume lacks.

---

## 3. Design

### 3.1 Evidence-only score

`evidenceScore(v, evidenceCutoff)` comes from a new `outputOnlyRollup`:

- Its input type is **provenance-tagged raw Jev judgments**, never finished `claimValue` numbers, which may already include note uplift. Claim values are recomputed inside it with referrer notes switched off.
- Every claim carries a `source`. Claims whose source is a referrer or committee member are rejected by the type, not by a filter.
- It has no `trend` parameter. It never reads comparisons, Referral Signal, or anything downstream of judge weights.
- Each result records the hash of its complete input claim set and its config.

### 3.2 Fixed dates, computed once

Each value has two dates: an **evidence cutoff** (which evidence counts) and a **compute time** (when it is calculated and stored). Both are fixed, so the order evidence arrives in never matters.

For referral `u → v` at `t_uv`, with grace period `G` (e.g. 30 days) and checkpoints `H_k` (e.g. 6, 12, 24 months):

| Value | Evidence cutoff | Computed and stored at |
|---|---|---|
| Starting score `s0_uv` | evidence dated ≤ `t_uv` | `t_uv + G` |
| Checkpoint score `s_k` | evidence dated ≤ `t_uv + H_k` | `t_uv + H_k + G` |
| Role mix `E_v` (over `<eng, design, gtm, founder>`) | evidence dated ≤ `t_uv` | `t_uv + G` |

- Stored values are never recomputed. Changing one is an explicit, logged correction.
- **No evidence dated ≤ `t_uv` at `t_uv + G`** means the referral is never scored, in either direction. It can't count against the judge, and it can't count for them if the candidate rises later.
- A candidate with a starting score always gets checkpoint scores. If they go quiet, their score stays flat and lands below normal movement, so failures are not hidden.
- **Unreferred candidates** use their first Jev intake date `t_v` in place of `t_uv`, with the same rules. They are needed for 3.3.

### 3.3 Movement against what's normal for the starting score

For each referral and each stored checkpoint `k`:

```
m_uvk  = s_k − s0_uv                          // raw movement
e_k(s) = normal movement at checkpoint k for a candidate starting at score s
r_uvk  = m_uvk − e_k(s0_uv)                   // movement beyond normal
d_uvk  = sign(r_uvk) · max(|r_uvk| − h, 0)    // dead band: |r| ≤ h counts as 0
```

- `e_k(s)` is fitted on **all** club candidates, referred or not. It depends on the exact starting score, so a high B and a low B are compared fairly, as are top and bottom bands.
- **`e_k` is frozen and versioned.** Each stored checkpoint result records the `e_k` version it used and keeps it. A refit is a new version with a drift report, and it applies only to checkpoints stored after it. The club growing never moves old results.
- `h` is about half a band width. B → B/B+ falls inside the dead band, and B → a solid B+ counts.
- Bands (C … A) are display labels only. The math uses the continuous score.

### 3.4 Judge weight

For each referral, `d_uv` is the `d_uvk` of its latest stored checkpoint. A referral is **informative** when `d_uv ≠ 0`.

```
c_u = Σ_{informative uv} d_uv / (n_inf,u + λ_c)     // only referrals that moved past the dead band
w_u = p̂_u · exp(κ · c_u)
```

- Referrals inside the dead band carry no information and are left out of both the sum and the count. **Adding referrals that don't move changes nothing**, whether the judge's average is positive or negative.
- Bad picks can't hide. A candidate who drops beyond normal, or stays flat when normal is upward, has `d_uv < 0` and counts.
- With `κ = 0`, `w_u = p̂_u`, and V3 output values equal V2's bit for bit. V3 gets its own run id, because run ids hash the spec version and parameters.

### 3.5 Per-role weights

Each informative referral's `d_uv` is credited to role `k` in proportion to its stored `E_v[k]`.

```
w_{u,k} = n_{u,k}/(n_{u,k}+λ) · ŵ_{u,k}  +  λ/(n_{u,k}+λ) · w_u
```

- `n_{u,k}`: the judge's role-weighted count of informative referrals in role `k`.
- The fallback is the judge's **overall** weight. With little data, per-role equals the single weight, so it adds no behaviour until there is data.
- Referral Signal uses `Σ_k E_v[k] · w_{u,k}`.

### 3.6 What is dropped from Phase E

| Phase E piece | What replaces it |
|---|---|
| Separate scout number `Ĝ_u` | Movement term inside the single weight (3.4) |
| `forecastKind: "will_compound"` tag | Every referral counts |
| Prior-recognition discount `(1 − π_v)` | Normal movement for the starting score (3.3) |
| Fixed `t0`/`t1` slope window, `minGapDays` | Stored checkpoints (3.2) |
| Upside-only `max(ΔR*, 0)` | Symmetric, measured against normal (3.3) |
| Surprise term in comparison selection, trajectory reporting | Not replaced. They don't move a judge's weight and can return separately |

---

## 4. Delivery order

Each step is its own PR and can be verified on its own:

1. **`outputOnlyRollup` and `evidenceScore`.** Provenance-tagged input, evidence cutoff, input hashing. No weight changes.
2. **Stored snapshots.** `s0`, checkpoints and `E_v` stored on referrals and on unreferred candidates' intake, plus the logged correction operation. No weight changes.
3. **The movement term.** `e_k` fitting and versioning, the dead band, `c_u`, `κ`. Register `judge_reliability@3.0.0` with a drift report on the seed. Not current until reviewed.
4. **Per-role split.** Its own version bump and drift report.

## 5. Invariants (tests)

- **κ = 0:** V3 output values equal V2's exactly. Runs still on V2 keep their golden run ids.
- **No judge input:** adding referrer notes, referrer-added claims, or a `trend` value never changes `evidenceScore`. Tested through the real claim-value code, and `outputOnlyRollup` rejects a judge-sourced claim at the type level.
- **Arrival order:** the same evidence arriving in different batches or orders gives the same stored snapshots.
- **Backfill:** evidence that arrives after a snapshot's compute time never changes that snapshot.
- **Padding:** adding referrals whose movement is inside the dead band never changes any judge's weight, for judges with positive or negative averages.
- **No starting score:** adding referrals with no evidence dated ≤ `t_uv` never changes any judge's weight.
- **Refit:** fitting a new `e_k` version never changes an already-stored checkpoint result.
- **Dead band:** movement within `h` of normal never changes any weight.
- **Fairness:** equally skilled simulated judges get weights within tolerance whether they pick top-band, bottom-band, high-in-band or low-in-band candidates.
- **Per-role fallback:** `w_{u,k} = w_u` when `n_{u,k} = 0`.

## 6. Open decisions

1. **Checkpoints:** several (6, 12, 24 months) so a candidate who takes off in year 2 still pays off, or one 12-month checkpoint for simplicity.
2. **How checkpoints combine:** latest stored (current default), mean, or weighted toward later checkpoints.
3. **Which Jev quantity `evidenceScore` is:** value (level), substance, or alpha (outperforming expectation). "B → B+" reads as level.
4. **Parameter values:** `G`, `h`, checkpoint times, `λ_c`, `κ`, `λ`, display band edges.
5. **How `e_k(s)` is fitted with a small club:** linear in `s` with pooling, isotonic, or band means as a fallback.
6. **Referral timing:** a judge who refers someone just before a big event they already know about (e.g. an offer) gets credit for it. Is that legitimate scouting or something to guard against?
7. **Referral-volume signal** (many referrals plus passing evaluations means a name is spreading). This is a candidate signal and is tracked separately.

## 7. Review history

- **Round 1 (Codex, on v1):** missing evidence made mass referrals a free bet. The circularity guard checked imports, not data. Equal up/down steps are unfair at the top and bottom of the ladder. Band hysteresis needed path history. "Run ids unchanged" was impossible under a new spec version.
- **Round 2 (Codex, on v2):** counting unresolved referrals as 0 helped judges with negative averages. Claim values could arrive already raised by notes. "Latest score" kept changing old results. A grace-period starting point absorbed post-referral improvement. Band-only expectation ignored position inside a band. Role mixes could change later.
- **Self-review (on v3):** padding still worked through referrals with a starting score that never moved. Referrer-added claims were not excluded. Starting scores locked on first arrival, so arrival order mattered. Refitting `e_k` moved old results.

v3.2 merges v2 and v3 and fixes all of the above (3.1–3.4). It has not been through an outside review yet.

## 8. Questions for reviewers

1. **Is this too complicated for the data we have?** A judge may have fewer than 10 referrals, and few will reach a 24-month checkpoint soon. Is there a simpler rule that keeps the properties that matter: hard to game, no circularity, stable history, fair across starting levels?
2. **Is anything still gameable?** Especially by a judge who influences what evidence a candidate submits, or who times referrals.
3. **Is there still circularity?** Any path from judge weights or judge-written content back into `evidenceScore`.
4. **Does leaving out non-informative referrals (3.4) create a new bias?**
5. **Is `e_k(s)` sound with few candidates?** What fitting method keeps noise from dominating the expectation?
6. **Per-role:** is falling back to the judge's overall weight the right default, and is a fixed role mix at referral time reasonable?

### Simpler fallback to compare against

- One checkpoint at 12 months.
- Starting score from evidence-only Jev, evidence dated ≤ referral, computed once at referral + 30 days. No starting score means not scored.
- `r = (s_12 − s0) − mean movement of all candidates in the same starting band` (frozen per version), with dead band `h`.
- `w_u = p̂_u · exp(κ · Σ_{|r|>h} d / (n_inf + λ))`. No per-role split yet.

Reviewers should argue for this, or for something simpler still, if the full design isn't worth it.
