# Judge weights from admission, accuracy and movement (v5, replaces Phase E)

**Status:** v5 draft for review. Not implemented. The Linear doc is the source of truth; this file is a copy so Codex and the PR reviewers can review it as a diff.
**Replaces:** #20–#27 (Phase E). That work was merged into `cursor/judge-calibration-demo-5d70` and never reached `main`. It is not ported.
**Builds on:** V2 judge calibration (`judge_reliability@2.0.0`, `src/judges/reliability.ts`), Referral Signal weighting (`src/scoring/weighting.ts`), Club decisions (`Decision`, `ClubSnapshot` in `apps/club/lib/types.ts`), and the Jev claim and rollup modules (`src/longitudinal/claimValue.ts`, `claimPreprocess.ts`, `personRollup.ts`).
**Spec versions touched:** registers `judge_reliability@4.0.0` (3.0.0 is reserved by Phase E's `docs/issues/20`). Each delivery step that changes numbers gets its own version and drift report.

---

## 0. Goals

1. **Calibrate a judge's weight as soon as possible.** Served by the admission signal (3.2), which arrives within weeks, so a new judge gets a real weight long before outcomes exist.
2. **Once calibrated, change smoothly over time.** Served by shrinkage (3.6), the dead band (3.5), settlement instead of sudden replacement (3.3), the continuous ramp in place of a switch (3.7), and frozen stored results (3.4). **Finding where a judge is strong** (per-role weights) is not in this version; it comes later (3.7).
3. **Reward spotting slope over credentialism and consensus bets.** Served by movement on substance measured against what's normal for the starting score (3.5), by accuracy's share fading as movement data arrives (3.6), and by settlement: admission credit is temporary and is replaced by what the candidate actually did (3.3).

## 1. Summary

People in the club refer candidates. Each referrer ("judge") has a **weight** in (0, 1) for how much their referrals count. Three signals feed it, each arriving later than the last:

| Signal | Arrives | Role |
|---|---|---|
| **Admission** (council admits or denies the referred candidate) | weeks | early calibration, credited now and settled later |
| **Accuracy** (V2: did the referral's strength match outcomes) | 6 months | middle term, fades as movement arrives |
| **Movement** (did the candidate's evidence-backed substance rise beyond normal) | 12 months | the long-run signal: spotting slope |

The core idea is **credit now, settle later**. When the council admits a judge's candidate, the judge gets early credit. When that candidate's 12-month movement result arrives, it **replaces** the admission credit:

- **Admitted and rose:** the judge is rewarded, with a larger stake because the club acted on their word.
- **Admitted and flopped:** the admission credit is taken back, and the judge is penalised with the same larger stake. People trusted the referral and it broke, so the weight changes, however the judge's weight was earned.
- **Denied and rose:** the judge saw something the council missed, so they are rewarded.
- **Denied and flopped:** the judge was wrong, but nothing was acted on, so the penalty is the ordinary size.

Rules that keep it hard to game and stable over time:

- The candidate score is built **only from evidence judges didn't write**.
- Every value has **fixed cutoffs and is stored once**. Later reruns, late evidence and reopened decisions never move old results.
- A judge never gets admission credit from a decision they took part in.
- Movement is judged **against what's normal for the candidate's starting score**.
- A judge's movement average uses **only referrals that moved past the noise threshold**, so padding with extra referrals does nothing.

---

## 2. What exists today (V2), as on `main` @ `7785c8d`

From `src/judges/reliability.ts` and `src/models/registry.ts`:

```
x_uv     = V0 strength of referral u → v
truth_uv = percentile of v's opportunity-corrected outcome residual R*_v, from outcomes after the referral
E_uv     = (x_uv − truth_uv)²
Ē_u     ← (1 − η)·Ē_u + η·E_uv          (chronological)
p_u      = exp(−τ·Ē_u)
p̂_u      = n/(n+λ)·p_u + λ/(n+λ)·priorReliability      // priorReliability = 1
```

- One prediction per (judge, candidate) pair: the earliest referral. It is scored only after the 180-day `observationWindowDays` and once the candidate has a later outcome.
- Shrinkage goes toward `priorReliability: 1`, so a judge with no scored referrals has the **maximum** weight. `populationMeanReliability` is computed but never used.
- `applyBiasCorrection: false` in 2.0.0, so the live Referral Signal contribution is `p̂_u · R_uv`.
- `judgeWeighting` (`src/scoring/weighting.ts:86`) throws when a reliability is outside [0, 1].
- `JudgeCalibration.dimension` is typed over rubric dimensions, not roles, and is always `null`.
- **Club decisions:** `Decision = "start_review" | "admit" | "deny" | "request_data" | "reopen"`. Each decision writes a `ClubSnapshot` with the Referral Signal the council saw. **No field records who decided.**
- Product rules: missing data is never treated as low. No single merged person score. Judge weights are hidden from members; admins see referrals ordered by reliability.

**Jev** turns a candidate's career claims into claim values, then rolls them up per person into `consensus`, `substance`, `value` and `alpha` (`personRollup.ts`). Paths by which judges can influence Jev today or soon:

- `consensus = selectionAggregate + wTrend · trend`, where `trend` is caller-supplied with no provenance check.
- In `career_evidence@1.2.0`, a `ReferrerNote` lifts a claim's backing from self-reported to corroborated (`claimValue.ts`).
- Referrer-added claims (SEA-61) are planned, not implemented.
- `claimValuesToLongitudinalRecords` (`claimValue.ts:272`) can turn note-raised claim values into `Outcome` rows. It has no callers yet.
- Evidence a judge helped write (a coached resume) enters as ordinary evidence. **This cannot be closed** by any rule below.

---

## 3. Design

### 3.1 Weight scale

```
logit w_u = logit μ0                                        // μ0 = 0.3: new judges start here
          + κ_a · A_u                                       // admission, unsettled referrals only (3.2)
          + π_u · (logit p̂⁰_u − logit μ0)                   // accuracy, fading share (3.6)
          + κ_m(t) · C_u                                    // movement, settled referrals (3.3, 3.5)
ω_u = w_u^γ                                                 // γ ≥ 1, start γ = 2
contribution_uv = ω_u · R_uv                                // what Referral Signal uses
```

- `p̂⁰_u` is V2 accuracy shrunk toward `μ0` instead of 1: `p̂⁰_u = n/(n+λ)·p_u + λ/(n+λ)·μ0`, clamped to `[ε, 1−ε]` before `logit`.
- `w_u` stays strictly inside (0, 1), so `judgeWeighting` never throws.
- Every term is an additive shift in log-odds, so it moves a judge by the same amount of evidence regardless of how their current weight was earned.
- `ω_u = w^γ` makes high weights count more. At γ = 2: 0.3 → 0.09, 0.6 → 0.36, 0.9 → 0.81.
- **V2 compatibility branch:** a spec flag `mode: "v2"` returns V2's `p̂_u` unchanged and skips the formula above. This keeps exact equivalence, including `p̂ = 1` for judges with no data, which the clamp would otherwise turn into `1 − ε`.

### 3.2 Admission signal (early calibration)

For referral `u → v` at `t_uv = referral.createdAt`:

```
a_uv = +1  if the decision standing on v at t_uv + D is "admit"
       −1  if it is "deny"
       unscored  otherwise (no decision, under review, needs data)
A_u  = Σ_{unsettled, scored} a_uv / (n_adm,u + λ_a)
```

- **Fixed date:** the decision counted is the one standing at `t_uv + D` (e.g. `D` = 60 days). A later `reopen` or reversal never changes it, except through a logged correction.
- **Recusal:** decisions get a new `decidedBy` field listing every admin who took part. A referral earns no admission credit, positive or negative, from a decision its judge took part in.
- **Self-referral and duplicates** follow `validateReferral`: one prediction per (judge, candidate) pair, the earliest referral.
- `A_u` sums only **unsettled** referrals. Once a referral has a movement result, its admission credit leaves `A_u` (3.3).
- **Feedback loop:** the council sees the Referral Signal, which includes the judge's weight. While judges are new, every judge sits at `μ0`, so the signal can't favour one judge's candidates over another's. The loop strengthens as weights spread out, which is why admission credit is temporary and gets settled.

### 3.3 Settlement: movement replaces admission credit

When referral `u → v` gets its movement result `d_uv` (3.5), its admission credit is removed and the settled result is added to `C_u`:

```
stake_uv = β    if a_uv = +1 (admitted: the club acted on the referral)        // β > 1, e.g. 2
           1    otherwise (denied, or no decision)
C_u = Σ_{settled, d_uv ≠ 0} stake_uv · d_uv / (n_inf,u + λ_c)                // λ_c > 0; C_u = 0 when n_inf,u = 0
```

| Admission | Movement | Effect on the judge |
|---|---|---|
| admitted | rose beyond normal | early credit replaced by a **β-sized reward** |
| admitted | fell beyond normal | early credit **taken back** and replaced by a **β-sized penalty** |
| denied | rose beyond normal | early penalty replaced by an ordinary reward: the judge saw what the council missed |
| denied | fell beyond normal | early penalty replaced by an ordinary penalty |
| either | inside the dead band | early credit removed, nothing added |

- Settlement is per referral and happens once. The weight changes smoothly because each settlement swaps one referral's contribution, not the judge's whole history.
- Referrals with no admission decision and no movement result contribute nothing.

### 3.4 Evidence-only substance, fixed cutoffs

`evidenceScore(v, cutoffs)` is Jev **substance**, computed by a new `outputOnlyRollup`. Substance, not value: value includes consensus, which counts missing selection evidence as 0 and jumps on hire dates.

**Judge-free input:**

- Input is provenance-tagged raw Jev judgments, never finished `claimValue` numbers. Claim values are recomputed with referrer notes switched off.
- Every claim gets a new `author` field (`candidate | referrer | committee | system`), separate from `source: SourceKind`. Only `candidate` and `system` claims are accepted, enforced by a runtime validator.
- No `trend` parameter. It never reads comparisons, Referral Signal, admission decisions, or anything downstream of judge weights.
- Each result records `hashInputs` of its input claims **sorted by claim id**, plus its config.
- V2's outcome labels never include `Outcome` rows derived from note-raised claim values.

**Two cutoffs per snapshot.** Each snapshot has an **evidence cutoff** (the date the evidence describes) and an **ingestion cutoff** (when the evidence reached us). Timing guard `G` (e.g. 30 days), arrival slack `S` (e.g. 30 days):

| Snapshot | Evidence dated | Ingested by | Stored at |
|---|---|---|---|
| `s0_uv` | ≤ `t_uv + G` | `t_uv + G + S` | `t_uv + G + S` |
| `s12_uv` | ≤ `t_uv + 12 months` | `t_uv + 12 months + S` | `t_uv + 12 months + S` |

- **No manufactured movement:** `s12` excludes any evidence dated ≤ `t_uv + G` that was ingested after `s0` was stored. Such evidence is logged and counted in neither snapshot. Withholding pre-referral evidence until after `s0` therefore never creates movement.
- **Timing guard:** evidence dated up to `G` after the referral counts toward the starting score, so referring someone just before an event you already know about earns nothing.
- **Output dates:** each output is dated by when it became observable (its own date, or `endedAt` for completed work). Undated output from an in-progress role is dated by the role's `startedAt`. Combined with the ingestion rule, a late resume can't turn old work into movement. The cost is conservative: real new output in a long-running role, if undated, is missed rather than counted.
- Stored snapshots are never recomputed. Changing one is an explicit, logged correction.
- **No starting score:** the referral never gets a movement result. It can still carry admission credit, which then never settles. See open decision 3.
- **Unreferred candidates** use their first Jev intake date in place of `t_uv`, with the same rules. They are needed for 3.5.

### 3.5 Movement against what's normal for the starting score

```
m_v    = s12 − s0                        // raw movement
e(s)   = a + b·s                         // normal movement for starting score s (pooled line)
r_uv   = m_v − e(s0_uv)                  // movement beyond normal
d_uv   = sign(r_uv) · max(|r_uv| − h, 0) // dead band, h in absolute substance units
```

- `e` is fitted on all club candidates with both snapshots, referred or not, **leaving out the candidate being scored**.
- `e` is **frozen and versioned**. Each stored result records the `e` version it used. A refit is a new version with a drift report and applies only to results stored after it.
- A candidate who goes quiet scores flat. That counts against the judge only when `e(s0) > h`; otherwise it falls inside the dead band.

### 3.6 Accuracy fades as movement arrives

```
π_u = λ_f / (λ_f + n_inf,u)
```

- With no movement data, accuracy has its full share. As a judge's settled, informative referrals grow, accuracy's share falls toward 0.
- Accuracy is level-based, so it rewards picking already-strong candidates. Fading it means a judge's long-run weight comes from spotting slope (goal 3), while accuracy still fills the 6–12-month gap (goal 1).

### 3.7 Calibration path

- **Movement ramp, not a switch:** `κ_m(t) = κ · K(t) / (K(t) + M)`, where `K(t)` is the number of club candidates with both snapshots. Movement fades in as the club's data grows. Adding one candidate changes every weight by a small, bounded amount, not a jump.
- **Judge label:** **provisional** until a judge has `N` scored signals (admission, accuracy or movement), then **calibrated**. Label only, admin-visible. The math is continuous.
- **Later versions**, each with its own version bump, drift report and data gate:
  - **Per-role weights** (finding where a judge is strong): needs a role taxonomy, a defined per-role estimate `ŵ_{u,k}`, and a migration of `JudgeCalibration.dimension` from rubric dimensions to roles. It shrinks toward the judge's overall weight.
  - **Extra movement checkpoints** (6 and 24 months): needs a rule for mixed horizons, since `e` normalizes the mean but not the variance across horizons.

### 3.8 What is dropped from Phase E

| Phase E piece | What replaces it |
|---|---|
| Separate scout number `Ĝ_u` | Movement term inside the single weight (3.3, 3.5) |
| `forecastKind: "will_compound"` tag | Every referral is eligible |
| Prior-recognition discount `(1 − π_v)` | Normal movement for the starting score (3.5) |
| Fixed `t0`/`t1` slope window, `minGapDays` | Stored snapshots with fixed cutoffs (3.4) |
| Upside-only `max(ΔR*, 0)` | Symmetric, with a larger stake on admitted referrals (3.3) |
| Surprise term in comparison selection, trajectory reporting | Not replaced. They don't move a judge's weight |

---

## 4. Delivery order

Each step is its own PR and can be verified on its own:

1. **Weight scale.** `μ0`, `γ`, the log-odds form with only the accuracy term, the V2 compatibility branch, and `judgeWeighting` using `ω_u`. Register `judge_reliability@4.0.0` with a drift report.
2. **Admission signal.** `decidedBy` on decisions, the decision standing at `t_uv + D`, recusal, `A_u`. This delivers goal 1. Its own version and drift report.
3. **Evidence-only substance.** `author` field and runtime validator, `outputOnlyRollup`, output dating, sorted hashing, the truth-label guard. No weight changes.
4. **Stored snapshots.** `s0` and `s12` with evidence and ingestion cutoffs, on referrals and on unreferred candidates' intake, plus the logged correction operation. No weight changes.
5. **Movement, settlement and fading.** `e` fitting and versioning, the dead band, stakes and settlement, `C_u`, the accuracy fade, the movement ramp, the judge label. Its own version and drift report.

## 5. Invariants (tests)

- **V2 compatibility:** `mode: "v2"` returns V2's outputs exactly, including `p̂ = 1` for judges with no data. Runs still on V2 keep their golden run ids.
- **Bounds:** `w_u` and `ω_u` are always in (0, 1), and `judgeWeighting` never throws.
- **Recusal:** a decision the judge took part in never changes that judge's weight.
- **Fixed decision date:** reopening or reversing a decision after `t_uv + D` never changes any weight, except through a logged correction.
- **Settlement:** once a referral settles, its admission credit is gone, and the judge's weight equals what it would be had that referral never carried admission credit, plus its settled result.
- **Stake:** an admitted referral that falls beyond normal costs β times what the same movement costs on a denied referral.
- **No judge input:** adding referrer notes, referrer- or committee-authored claims, a `trend` value, or an admission decision never changes `evidenceScore`.
- **Truth labels:** V2 outcome labels never include rows derived from note-raised claim values.
- **No manufactured movement:** pre-referral evidence ingested after `s0` is stored never changes `s12` or any weight.
- **Arrival order:** the same evidence in different batches or orders gives the same stored snapshots and hashes.
- **Backfill:** evidence ingested after a snapshot's ingestion cutoff never changes it.
- **Padding:** adding referrals whose movement falls inside the dead band never changes any judge's movement term.
- **Refit:** a new `e` version never changes an already-stored result.
- **Fade:** accuracy's share `π_u` falls monotonically as `n_inf,u` grows.
- **Ramp:** adding one candidate with both snapshots changes any weight by at most a stated bound.
- **Fairness:** a seeded simulation, with its data-generating process and tolerance written down before step 5, shows:
  - equally skilled judges get weights within tolerance whether they pick high or low starting scores;
  - a judge who repeatedly picks obvious, already-strong candidates ends below a judge with equal accuracy who spots early risers, once movement data exists.

## 6. Open decisions

1. **Parameter values:** `μ0 = 0.3` and `γ = 2` are chosen. Still to set from the seed: `β`, `D`, `G`, `S`, `h`, `κ_a`, `κ`, `M`, `N`, `λ`, `λ_a`, `λ_c`, `λ_f`.
2. **Denied and rose:** this rewards the judge for disagreeing with the council. Should that reward be larger than ordinary, since it's the clearest sign of spotting slope?
3. **Admission credit that never settles:** a referral with an admission decision but no starting score keeps its admission credit forever. Should it expire after a fixed time instead?
4. **Undated in-progress output:** the conservative dating rule can miss real growth in a long-running role, which makes a candidate look flat. Is that acceptable?
5. **Display bands** (C … A on value) for admins: separate from this spec.
6. **Referral-volume signal** (many referrals plus passing evaluations means a name is spreading): a candidate signal, tracked separately.

## 7. Review history

- **Round 1 (Codex, v1):** free bet on candidates without evidence; import-only circularity guard; unfair steps at ladder ends; hysteresis needed history; impossible run-id invariant. Fixed in v2.
- **Round 2 (Codex, v2):** padding helped negative judges; note-raised values reached the rollup; "latest score" moved old results; grace-period lookahead; band-only expectation; mutable role mix. Fixed in v3.
- **Self-review (v3):** padding through non-moving referrals; referrer-added claims; arrival order; refits moved old results. Fixed in v3.2.
- **Round 3 (Kimi K3 max, Grok 4.7 xhigh, v3.2):** weight above 1; shrinkage toward 1; version clash; V2 description; judge inputs; hash order; resume-date exploit; hidden truth-label path; coached evidence; undefined per-role; mixed horizons; winner's curse; minimum cohort; `h` units; timing; value vs substance; name clash. Fixed in v4.
- **Round 4 (Codex, v4):** handled in v5:
  - Late evidence manufactures movement → ingestion cutoffs and the exclusion rule (3.4).
  - Accuracy still rewards credentialism → accuracy fades as movement arrives (3.6), plus a fairness simulation (§5).
  - No early calibration → admission signal (3.2).
  - Abrupt club gate → continuous ramp (3.7).
  - Goal 2 not delivered → narrowed to smooth change; per-role weights are a later version (§0, 3.7).
  - V2 equivalence false at `p̂ = 1` → explicit compatibility branch (3.1).

## 8. Questions for reviewers (round 5)

1. **Credit now, settle later:** is replacing admission credit with the movement result sound? Does it create a reason to delay or speed up decisions?
2. **Stake β:** is a larger stake on admitted referrals the right way to express "people trusted it and it broke"? Could it discourage judges from referring borderline candidates who might be admitted?
3. **Feedback loop:** is the loop between judge weight, the Referral Signal the council sees, and admission credit small enough while weights are near `μ0`?
4. **Recusal:** is `decidedBy` enough when admins can discuss a candidate before one of them records the decision?
5. **Fading accuracy:** is `λ_f / (λ_f + n_inf)` the right shape, or should accuracy fade on time instead of on movement data?
6. **Anything still gameable or circular.**
