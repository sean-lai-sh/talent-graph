# Judge weights from candidate movement (v4, replaces Phase E)

**Status:** v4 draft for review. Not implemented. The Linear doc is the source of truth; this file is a copy so Codex and the PR reviewers can review it as a diff.
**Replaces:** #20–#27 (Phase E). That work was merged into `cursor/judge-calibration-demo-5d70` and never reached `main`. It is not ported.
**Builds on:** V2 judge calibration (`judge_reliability@2.0.0`, `src/judges/reliability.ts`), Referral Signal weighting (`src/scoring/weighting.ts`), and the Jev claim and rollup modules (`src/longitudinal/claimValue.ts`, `claimPreprocess.ts`, `personRollup.ts`).
**Spec versions touched:** registers `judge_reliability@4.0.0` (3.0.0 is reserved by Phase E's `docs/issues/20`). Each delivery step that changes numbers gets its own version and drift report.

---

## 0. Goals

1. **Calibrate a judge's weight as soon as possible.** A new judge shouldn't sit at a placeholder for long. Served by: the low starting weight (3.1), accuracy-only weights before the club gate (3.6), and the timing guard so early evidence counts (3.3). The 180-day accuracy window and the 12-month movement checkpoint slow this goal down. See question 6 in §8.
2. **Once calibrated, change smoothly over time and find where a judge is strong.** Weights shouldn't jump on one candidate, and should show which kinds of candidates a judge evaluates well. Served by: shrinkage and `λ_c` (3.5), the dead band (3.4), frozen stored results (3.3), and per-role weights as the later version that finds a judge's strong areas (3.6).
3. **Reward spotting slope over credentialism and consensus bets.** Backing someone who is already credentialed or widely agreed on should earn little. Backing someone who then rises beyond what's normal should earn a lot. Served by: measuring substance rather than value or consensus (3.2), and scoring movement against what's normal for the starting score (3.4), so an already-strong pick that merely stays strong earns about 0.

## 1. Summary

People in the club refer candidates. Each referrer ("judge") has a **weight** in [0, 1] for how much their referrals count. This spec changes three things:

1. **Judges start low and earn weight.** A new judge starts at 0.3, not 1. Weights near 1 count disproportionately more than weights near 0.3.
2. **Later movement counts.** If a candidate's evidence-backed substance rises beyond what's normal for where they started, the judge who referred them gains weight. A drop beyond normal costs weight. Small wobble is noise and does nothing.
3. **Calibration happens in stages.** Until the club has enough data, weights come from accuracy only. The movement term switches on for the whole club once there's enough 12-month data. Per-role weights and extra checkpoints come later, each with its own data gate.

Rules that keep it hard to game and stable over time:

- The candidate score is built **only from evidence judges didn't write**.
- Every value has a **fixed evidence cutoff and a fixed compute time, and is stored once**. Later reruns never move old results.
- Movement is judged **against what's normal for the candidate's starting score**.
- A judge's average uses **only referrals that moved past the noise threshold**, so padding with extra referrals does nothing.

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
- `JudgeCalibration.dimension` is typed over rubric dimensions (problem_solving, taste, …), not roles, and is always `null`.
- Product rules: missing data is never treated as low. No single merged person score. Judge weights are hidden from members; admins see referrals ordered by reliability.

**Jev** turns a candidate's career claims into claim values, then rolls them up per person into `consensus`, `substance`, `value` and `alpha` (`personRollup.ts`). Paths by which judges can influence Jev today or soon:

- `consensus = selectionAggregate + wTrend · trend`, where `trend` is caller-supplied with no provenance check.
- In `career_evidence@1.2.0`, a `ReferrerNote` lifts a claim's backing from self-reported to corroborated (`claimValue.ts`).
- Referrer-added claims (SEA-61) are planned, not implemented.
- `claimValuesToLongitudinalRecords` (`claimValue.ts:272`) can turn note-raised claim values into `Outcome` rows. It has no callers yet. If it ever fed `computeJudgeCalibration`, judge-written text would move V2's truth labels without tripping the import guard.
- Evidence a judge helped write (a coached resume) enters as ordinary `resume`/`github`/`x`/`other` evidence. **This cannot be closed** by any rule below.

---

## 3. Design

### 3.1 Weight scale: start at 0.3, high weights count more

```
p̂_u = n/(n+λ)·p_u + λ/(n+λ)·μ0                  // μ0 = 0.3: new judges start here
w_u = σ( logit(clamp(p̂_u, ε, 1−ε)) + κ·c_u )    // movement term on the log-odds scale (3.5)
ω_u = w_u^γ                                      // γ ≥ 1, start γ = 2
contribution_uv = ω_u · R_uv                     // what Referral Signal uses
```

- `w_u` stays strictly inside (0, 1) for any `c_u`, so `judgeWeighting` never throws.
- `ω_u = w^γ` makes high weights count more. At γ = 2: 0.3 → 0.09, 0.6 → 0.36, 0.9 → 0.81, so a proven judge counts 9× a new one instead of 3×. An inverse square like `1/(1−w)²` was considered and rejected: it is unbounded as `w → 1`.
- With `μ0 = 1`, `γ = 1`, `κ = 0`, this is V2 exactly.
- Moving `μ0` from 1 to 0.3 lowers every Referral Signal from judges with no record by the same factor. It does not reorder candidates referred only by such judges.

### 3.2 Evidence-only substance

`evidenceScore(v, evidenceCutoff)` is Jev **substance**, computed by a new `outputOnlyRollup`. Substance, not value: value includes consensus, which counts missing selection evidence as 0 and jumps on hire dates.

- **Input:** provenance-tagged raw Jev judgments, never finished `claimValue` numbers. Claim values are recomputed inside it with referrer notes switched off.
- **Author:** every claim gets a new `author` field (`candidate | referrer | committee | system`), separate from the existing `source: SourceKind`, which records where the evidence came from. Only `candidate` and `system` claims are accepted. A runtime validator enforces this, because TypeScript types are erased at runtime.
- **No `trend`** parameter. It never reads comparisons, Referral Signal, or anything downstream of judge weights.
- **Hash:** each result records `hashInputs` of its input claims **sorted by claim id** (`hashInputs` keeps array order) plus its config.
- **Evidence dates:** a claim's date for cutoffs is when the work was observable, never when the document was uploaded. Completed work uses `endedAt`. In-progress work uses `startedAt`, not the resume's `publishedAt` (today `claimPreprocess.ts:794` uses `publishedAt` for in-progress output claims). A resume uploaded after a referral that describes pre-referral work therefore feeds the starting score, not movement.
- **Truth-label guard:** V2's outcome labels never include `Outcome` rows derived from note-raised claim values.

### 3.3 Fixed dates, computed once

Each value has an **evidence cutoff** (which evidence counts) and a **compute time** (when it's calculated and stored), with timing guard `G` (e.g. 30 days) and arrival slack `A` (e.g. 30 days). `t_uv = referral.createdAt`.

| Value | Evidence cutoff | Computed and stored at |
|---|---|---|
| Starting score `s0_uv` | evidence dated ≤ `t_uv + G` | `t_uv + G + A` |
| 12-month score `s12_uv` | evidence dated ≤ `t_uv + 12 months` | `t_uv + 12 months + A` |

- **Timing guard:** evidence dated up to `G` after the referral counts toward the starting score. Referring someone a week before an offer you already know about earns nothing.
- Stored values are never recomputed. Changing one is an explicit, logged correction.
- **No starting score** (no evidence dated ≤ `t_uv + G` by its compute time): the referral is never scored, in either direction.
- **No 12-month score yet:** the referral is pending and unscored, never 0.
- **Unreferred candidates** use their first Jev intake date in place of `t_uv`, with the same rules. They are needed for 3.4.

### 3.4 Movement against what's normal for the starting score

```
m_v    = s12 − s0                        // raw movement
e(s)   = a + b·s                         // normal movement for starting score s (pooled line)
r_uv   = m_v − e(s0_uv)                  // movement beyond normal
d_uv   = sign(r_uv) · max(|r_uv| − h, 0) // dead band
```

- `e` is fitted on all club candidates with both scores, referred or not, **leaving out the candidate being scored**.
- `e` is **frozen and versioned**. Each stored result records the `e` version it used. A refit is a new version with a drift report and applies only to results stored after it.
- `h` is in absolute substance units, set from the seed. Bands (C … A) don't exist on `main` and aren't needed here.
- A candidate who goes quiet scores flat. That counts against the judge only when `e(s0) > h`. Otherwise it falls inside the dead band and is left out.

### 3.5 Movement term

```
c_u = Σ_{d_uv ≠ 0} d_uv / (n_inf,u + λ_c)     // λ_c > 0; c_u = 0 when n_inf,u = 0
```

- Only referrals past the dead band count, so **adding referrals that don't move changes nothing**, whether the judge's average is positive or negative.
- `λ_c > 0` keeps a single big mover from swinging a judge, since leaving out dead-band referrals makes the average rest on few points.

### 3.6 Calibration path

| Level | State | Rule |
|---|---|---|
| Club | **uncalibrated** | Fewer than `M` candidates with both `s0` and `s12`. `κ` is effectively 0: weights come from accuracy only (3.1). |
| Club | **calibrated** | `M` reached. The movement term switches on, club-wide, at once. The switch is recorded in the run's options. |
| Judge | **provisional** | Fewer than `N` scored referrals. Label only, admin-visible. |
| Judge | **calibrated** | `N` or more scored referrals. Label only. |

- The judge label never changes the math. Weights move smoothly through shrinkage, so there's no jump at `N` to game.
- The club switch is a real switch, but it applies to everyone at once, so no single judge can game it.

**Later versions**, each with its own version bump, drift report and data gate:

- **Per-role weights:** needs a role taxonomy, a defined per-role estimate `ŵ_{u,k}`, and a migration of `JudgeCalibration.dimension` from rubric dimensions to roles. It shrinks toward the judge's overall weight.
- **Extra movement checkpoints** (6 and 24 months): needs a rule for mixed horizons, since `e` normalizes the mean but not the variance across horizons.

### 3.7 What is dropped from Phase E

| Phase E piece | What replaces it |
|---|---|
| Separate scout number `Ĝ_u` | Movement term inside the single weight (3.1, 3.5) |
| `forecastKind: "will_compound"` tag | Every referral with a starting score is eligible |
| Prior-recognition discount `(1 − π_v)` | Normal movement for the starting score (3.4) |
| Fixed `t0`/`t1` slope window, `minGapDays` | Stored starting and 12-month scores (3.3) |
| Upside-only `max(ΔR*, 0)` | Symmetric, measured against normal (3.4) |
| Surprise term in comparison selection, trajectory reporting | Not replaced. They don't move a judge's weight |

---

## 4. Delivery order

Each step is its own PR and can be verified on its own:

1. **Weight scale.** `μ0`, `γ`, the log-odds form, and `judgeWeighting` using `ω_u`. Register `judge_reliability@4.0.0` with a drift report. This changes numbers.
2. **Evidence-only substance.** `author` field and runtime validator, `outputOnlyRollup`, the evidence-date rule, sorted input hashing, the truth-label guard. No weight changes.
3. **Stored snapshots.** `s0` and `s12` stored on referrals and on unreferred candidates' intake, plus the logged correction operation. No weight changes.
4. **Movement term and calibration path.** `e` fitting and versioning, the dead band, `c_u`, `κ`, the club switch at `M`, the judge label at `N`. Its own version and drift report.

## 5. Invariants (tests)

- **V2 equivalence:** with `μ0 = 1`, `γ = 1`, `κ = 0`, output values equal V2's exactly. Runs still on V2 keep their golden run ids.
- **Bounds:** `w_u` and `ω_u` are always in (0, 1), and `judgeWeighting` never throws, for any `c_u`.
- **No judge input:** adding referrer notes, referrer- or committee-authored claims, or a `trend` value never changes `evidenceScore`. Tested through the real claim-value code, including the runtime validator.
- **Truth labels:** V2 outcome labels never include rows derived from note-raised claim values.
- **Arrival order:** the same evidence in different batches or orders gives the same stored snapshots and hashes.
- **Backfill:** evidence arriving after a snapshot's compute time never changes it.
- **Late resume:** a resume uploaded after the referral, describing pre-referral work, changes `s0` (if before its compute time) and never counts as movement.
- **Padding:** adding referrals whose movement falls inside the dead band never changes any judge's weight, for positive or negative averages.
- **No starting score:** adding referrals with no starting score never changes any judge's weight.
- **Refit:** a new `e` version never changes an already-stored result.
- **Empty:** `c_u = 0` when `n_inf,u = 0`.
- **Club gate:** below `M`, every weight equals its accuracy-only value.
- **Fairness:** a seeded simulation, with its data-generating process and tolerance written down before step 4, shows equally skilled judges get weights within tolerance whether they pick high or low starting scores.

## 6. Open decisions

1. **Parameter values:** `μ0 = 0.3` and `γ = 2` are chosen. Still to set from the seed: `λ`, `λ_c`, `κ`, `h`, `G`, `A`, `M`, `N`.
2. **In-progress work:** dating in-progress claims by `startedAt` puts all of a long-running job into the starting score. Movement then shows up only when new claims appear (a new role, or the job's end). Is that acceptable, or should in-progress output accrue over time?
3. **Display bands** (C … A on value) for admins: separate from this spec.
4. **Referral-volume signal** (many referrals plus passing evaluations means a name is spreading): a candidate signal, tracked separately.

## 7. Review history

- **Round 1 (Codex, v1):** free bet on candidates without evidence; import-only circularity guard; unfair steps at ladder ends; hysteresis needed history; impossible run-id invariant. Fixed in v2.
- **Round 2 (Codex, v2):** padding helped negative judges; note-raised values reached the rollup; "latest score" moved old results; grace-period lookahead; band-only expectation; mutable role mix. Fixed in v3.
- **Self-review (v3):** padding through non-moving referrals; referrer-added claims; arrival order; refits moved old results. Fixed in v3.2.
- **Round 3 (Kimi K3 max, Grok 4.7 xhigh, v3.2):** all verified against `main`. Handled in v4:
  - Weight above 1 breaks `judgeWeighting` → log-odds form, bounded (3.1).
  - Shrinkage is toward 1, not the population mean → corrected (§2); prior is now `μ0 = 0.3` (3.1).
  - Version clash → `@4.0.0`.
  - V2 description (180-day window, bias off, live signal `p̂·R`) → corrected (§2).
  - Judge inputs described wrong; no referrer `SourceKind` → new `author` field with runtime validator (3.2).
  - `hashInputs` keeps array order → sort by claim id (3.2).
  - In-progress claims dated by `publishedAt` → date by `startedAt` (3.2).
  - Hidden truth-label path → guard and invariant (3.2, §5).
  - Coached evidence → stated as unclosable (§2).
  - `ŵ_{u,k}` undefined, roles don't exist, `dimension` type → per-role moved to a later version (3.6).
  - Mixed horizons → one 12-month checkpoint; extras later (3.6).
  - Winner's curse → `λ_c > 0`, `c_u = 0` when empty (3.5).
  - Minimum cohort and leave-one-out → club gate `M` and leave-one-out fit (3.4, 3.6).
  - `h` units → absolute substance units (3.4).
  - Timing → evidence within `G` counts toward the starting score (3.3).
  - Value vs substance → substance (3.2).
  - Name clash → "movement checkpoints".
  - Simpler-version recommendation → adopted as the calibration path (3.6).

## 8. Questions for reviewers (round 4)

1. **Weight scale:** is `σ(logit(p̂) + κ·c)` then `w^γ` sound? Does `μ0 = 0.3` with γ = 2 (new judges count 9%) suppress the signal too much while the club is small?
2. **Shrinkage toward 0.3:** a judge with raw accuracy above 0.3 is pulled down until they have data. Is that the right behaviour for a club that's just starting?
3. **Club gate:** is a single club-wide switch at `M` safe, given that it changes every weight at once?
4. **Evidence dates:** is the `startedAt` rule for in-progress work right (open decision 2)?
5. **Anything still gameable or circular** after the `author` field and the truth-label guard?
6. **Speed of calibration (goal 1):** accuracy needs 180 days and movement needs 12 months, so a new judge's weight barely moves in year one. Is there an earlier signal that is still hard to game, such as evaluation results or a shorter first checkpoint, that would calibrate faster?
7. **Slope over credentialism (goal 3):** does the accuracy part of the weight (V2's level-based `truth_uv`) still reward consensus bets enough to work against goal 3? Should its share of the weight shrink once movement data exists?
