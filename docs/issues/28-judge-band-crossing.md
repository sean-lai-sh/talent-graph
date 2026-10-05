# Judge weights from admission, accuracy and movement (revision 8, replaces Phase E)

**Status:** revision 8 (r8) of the spec, for review. Not implemented. The Linear doc is the source of truth; this file is a copy so Codex and the PR reviewers can review it as a diff. "Revision" numbers the doc; the engine version it ships as is `judge_reliability@4.0.0`.
**Replaces:** #20–#27 (Phase E). That work was merged into `cursor/judge-calibration-demo-5d70` and never reached `main`. It is not ported.
**Builds on:** V2 judge calibration (`judge_reliability@2.0.0`, `src/judges/reliability.ts`), Referral Signal weighting (`src/scoring/weighting.ts`), Club decisions and referral questions (`Decision`, `ClubSnapshot` in `apps/club/lib/types.ts`; SEA-62), the Jev claim and rollup modules (`src/longitudinal/claimValue.ts`, `claimPreprocess.ts`, `personRollup.ts`), and the exploratory under-recognition diagnostic (`src/analysis/underRecognition.ts`).
**Simulation:** step 0 is built in PR #116 (`bun run sim:judges`). Its r7 results drove most of the changes here.
**Grounding:** Rich Zou, ["Out of Distribution"](https://richzou.com/essays/out-of-distribution). The best people often look like bad bets on paper (thin or "incoherent" records, unconventional paths) and are rejected by evaluators who pattern-match on credentials. This spec aims to reward the judges who spot them.
**Spec versions touched:** registers `judge_reliability@4.0.0` (3.0.0 is reserved by Phase E's `docs/issues/20`). Each delivery step that changes numbers gets its own version and drift report.

---

## 0. Goals

1. **Calibrate a judge's weight as soon as possible.** Served by the admission signal (3.3), which arrives within weeks.
2. **Once calibrated, change smoothly over time.** Served by the soft cap and per-referral contributions (3.1), settlement one referral at a time (3.4), the centred dead band (3.6), the gated ramp (3.8), and frozen stored results (3.5). **Finding where a judge is strong** (per-role weights) comes in a later version (3.8).
3. **Reward spotting slope over credentialism and consensus bets, including out-of-distribution people.** Served by:
   - the position schedule, credential gap and recognition bet (3.2);
   - escrow for contrarian bets, so a credential-biased council can't punish a judge before the evidence is in (3.3);
   - compressed rather than capped movement, so a breakout counts for more than a modest rise (3.4);
   - a 24-month checkpoint for contrarian bets, for late bloomers (3.5);
   - thin starting scores, so people with little conventional evidence can still be scored (3.5);
   - accuracy fading as movement data arrives (3.7);
   - the anti-cohort watch: the committee follows up on the people the club passed over (3.11).

## 1. Summary

People in the club refer candidates. Each referrer ("judge") has a **weight** in (0, 1) for how much their referrals count. Three signals feed it, each arriving later than the last:

| Signal | Arrives | Role |
|---|---|---|
| **Admission** (council admits or denies the referred candidate) | weeks | early calibration, credited now and settled later |
| **Accuracy** (V2: did the referral's strength match outcomes) | 6 months | middle term, fades as movement arrives |
| **Movement** (did the candidate's evidence-backed substance rise beyond normal) | 12 months, and 24 for contrarian bets | the long-run signal: spotting slope |

**Credit now, settle later.** The council's decision gives the judge early credit or debit. The candidate's movement result later replaces it:

- **Admitted and rose:** rewarded. The more the council relied on this judge, the larger the stake.
- **Admitted and flopped:** the early credit is taken back and replaced by a penalty with the same larger stake.
- **Denied and rose:** rewarded at the ordinary stake. The council missing someone is not a failure of the judge.
- **Denied and flopped:** an ordinary penalty.
- **Contrarian bet denied:** if the judge said the candidate isn't recognised yet, or the candidate's substance is ahead of their credentials, the denial's early debit is **held in escrow** until the evidence is in.

**Every referral's credit is scaled by three things fixed at referral time:** position (advocate, validator, confirmer), credential gap (pre-credential or consensus), and the judge's recognition answer.

**The anti-cohort watch.** Each quarter, the organising committee checks in by hand on a bounded set of people the club passed over but the best judges bet on. Checkers predict before they look, enter only sourced facts, and flag exaggerated claims. This catches the council's misses, releases escrowed penalties, corrects coached exaggerations, and trains the committee's own judgement.

Rules that keep it hard to game and stable over time:

- The candidate score is built **only from evidence judges didn't write**. Committee checkers may add sourced facts and flags, never opinions.
- Every value has **fixed cutoffs and is stored once**. Corrections are explicit and logged.
- A judge never gets credit from a decision they took part in, or from an admission their own weight caused.
- **Extra effort can release a penalty but never create a reward.** Judge rewards come only from the standard check every candidate gets.
- A judge's total moves within a **soft cap**, so weights stay distinguishable and no event reprices a judge's history.

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
- **Referral questions:** referrals already have a questions step after "Submit referral" (SEA-62).
- **Data:** there is no real data yet. Existing referrals and decisions are test data and can be reset with the dev seed (SEA-68). No migration is needed.

**Jev** splits every job into **selection** claims (getting hired somewhere selective: credentials) and **output** claims (what the person did: substance), and rolls them up into `consensus`, `substance`, `value` and `alpha` (`personRollup.ts`). Substance is a top-3 mean over a growing pile of evidence, so it rarely falls: movement is skewed upward. Paths by which judges can influence Jev today or soon:

- `consensus = selectionAggregate + wTrend · trend`, where `trend` is caller-supplied with no provenance check.
- In `career_evidence@1.2.0`, a `ReferrerNote` lifts a claim's backing from self-reported to corroborated (`claimValue.ts`).
- Referrer-added claims (SEA-61) are planned, not implemented.
- `claimValuesToLongitudinalRecords` (`claimValue.ts:272`) can turn note-raised claim values into `Outcome` rows. It has no callers yet.

---

## 3. Design

### 3.1 Weight scale

```
Σ_u       = Σ_{unsettled uv} ℓᴬ_uv                       // admission credit (3.3)
          + π_u · (logit p̂⁰_u − logit μ0)                // accuracy, fading share (3.7)
          + κ_m(t) · Σ_{settled uv} ℓᴹ_uv                // movement results (3.4, 3.6)
logit w_u = logit μ0 + T · tanh(Σ_u / T)                 // μ0 = 0.3; soft cap T (e.g. 3 → w within about 0.02–0.9)
ω_u       = w_u^γ                                        // γ = 2
contribution_uv = ω_u · R_uv                             // what Referral Signal uses
```

- `p̂⁰_u` is V2 accuracy shrunk toward `μ0` instead of 1, clamped to `[ε, 1−ε]` before `logit`.
- **Soft cap:** `T · tanh(Σ/T)` behaves like `Σ` for small totals and saturates gently toward `±T`. Weights stay distinguishable, float rounding can never reach 0 or 1, and every event's effect on `logit w` is at most its effect on `Σ`.
- Each `ℓ` is computed once per referral and capped per referral (`|ℓᴬ| ≤ Lᴬ`, `|ℓᴹ| ≤ Lᴹ`). There are no shared denominators, so one referral's event changes only that referral's terms.
- `ω_u = w^γ` makes high weights count more. At γ = 2: 0.3 → 0.09, 0.6 → 0.36, 0.9 → 0.81.
- **V2 compatibility branch:** a spec flag `mode: "v2"` returns V2's `p̂_u` unchanged, including `p̂ = 1` for judges with no data.

### 3.2 What each referral is worth: position, gap, recognition

All three factors are fixed at `t_uv + max(D, G + S)`, once the decision date and the starting snapshot have both passed, and stored with the referral.

**Position** (the judge's timing). A candidate's referrals are ranked by `createdAt`, counting distinct judges and each judge's earliest referral. Self-referrals and duplicates take no position. Ties on the same day share the average of their positions.

```
share(k) = max(φ, 1 / k^α)
```

**Credential gap** (whether the candidate was obvious from credentials), from this referral's starting snapshot `s0_uv` (3.5):

```
gap_uv = substance(s0_uv) − f(selection(s0_uv))     // f: expected substance given credentials, frozen and versioned
c_uv   = clip(1 + β_g · gap_uv, c_min, c_max)        // gap > 0: pre-credential, stake up; gap < 0: consensus, stake down
```

Admin display labels: **pre-credential** (`gap ≥ g0`), **consensus** (high selection and `gap ≤ −g0`), **neither**. The labels never feed the maths.

**Recognition answer** (the judge's own bet). A referral question:

> **Has this person received the recognition their ability deserves?**
> Not yet · Soon (within a year) · Yes, already · Not sure

```
b_uv = b_notyet | b_soon | b_yes | 1 for "Not sure" or no answer
```

The answer is the judge's prediction, never evidence. It is frozen at referral time. The stake is symmetric: a bigger bet means a bigger reward and a bigger loss.

**Per-referral weight:** `q_uv = share(k_uv) · c_uv · b_uv`.

A referral is a **contrarian bet** when `b_uv` is "Not yet" or "Soon", or `gap_uv ≥ g0`.

### 3.3 Admission signal (early calibration)

```
a_uv  = +1 if the decision standing on v at t_uv + D is "admit", −1 if "deny", unscored otherwise
ρ_uv  = clip( (S_v − S_v^{−u}) / S_v, 0, 1 )   if admitted;   0 otherwise
ℓᴬ_uv = clip( κ_a · q_uv · a_uv · (1 − ρ_uv), −Lᴬ, Lᴬ )
```

- **Leave-one-judge-out, admissions only.** Each decision snapshot records, for every referrer, the Referral Signal **without** that referrer (`S_v^{−u}`) next to the full signal (`S_v`). For an admission, early credit counts only the part the judge's own weight didn't cause. A **denial always carries the full early debit**, unless it's escrowed. The judge didn't cause a denial, so their share of the signal is irrelevant.
- **Escrow for contrarian bets.** If the referral is a contrarian bet (3.2) and the candidate is denied, the early debit is **held, not applied**. It is resolved by whichever comes first:
  - the referral's movement settlement (3.4), which replaces it as usual;
  - an anti-cohort check finding the person rose (3.11), which **releases** it to 0.
- **Fixed date:** the decision counted is the one standing at `t_uv + D`. A later `reopen` or reversal never changes it, except through a logged correction.
- **Recusal:** decisions get a new `decidedBy` field. A judge who took part in a decision gets no admission credit from it. Their referral keeps its own position for its stake, takes no position away from others, and settles at stake 1.
- **Referrals made after a decision** get no admission credit, because the judge could already see the outcome. They still take a position.
- **Starting snapshot required:** admission credit applies only once the referral has `s0` (3.5), which with thin starting scores means once Jev has run an intake.
- **Admins see** each judge's weight and each referral's recognition answer. Members never see judge weights.

### 3.4 Settlement: movement replaces admission credit

When a referral gets its movement result `d_uv` (3.6), its `ℓᴬ_uv` (applied or escrowed) is removed and its movement term is added:

```
stake_uv = 1 + (β − 1) · ρ_uv     if admitted;   1 otherwise
ψ(d)     = sign(d) · ln(1 + |d|)                      // compress, don't truncate
ℓᴹ_uv    = clip( q_uv · stake_uv · ψ(d_uv), −Lᴹ, Lᴹ )  // Lᴹ generous, a backstop for the per-event bound
```

| Admission | Movement | Effect on the judge |
|---|---|---|
| admitted | rose beyond normal | early credit replaced by a reward, scaled up by reliance |
| admitted | fell beyond normal | early credit taken back and replaced by a penalty, scaled up by reliance |
| denied | rose beyond normal | early debit (or escrow) replaced by an ordinary reward |
| denied | fell beyond normal | early debit (or escrow) replaced by an ordinary penalty |
| either | inside the dead band | early credit or debit removed, nothing added |

- **Compression, not truncation:** `ψ` grows slowly, so a breakout counts for more than a modest rise without one result dominating. The soft cap (3.1) bounds the total.
- **Contrarian bets settle twice.** They settle provisionally at 12 months, then once more at 24 months, when the 24-month result replaces the 12-month term. Other referrals settle at 12 months only.

### 3.5 Evidence-only substance, fixed cutoffs

`evidenceScore(v, cutoffs)` gives Jev **substance** and **selection**, computed by a new `outputOnlyRollup`.

**Judge-free input:**

- Input is provenance-tagged raw Jev judgments, never finished `claimValue` numbers. Claim values are recomputed with referrer notes switched off.
- Every claim gets an `author` field (`candidate | referrer | committee | system`), separate from `source: SourceKind`. Accepted:
  - `candidate` and `system` claims;
  - `committee` claims that are **sourced facts**: they must carry a verifiable source (URL or document) and are judged by Jev like any evidence.

  Rejected: `referrer` claims, and any committee assessment or opinion. A runtime validator enforces this.
- **Committee flags** (3.12) can lower a claim's backing. They never add value.
- No `trend` parameter. It never reads comparisons, Referral Signal, admission decisions, recognition answers, or anything downstream of judge weights.
- Each result records `hashInputs` of its input claims **sorted by claim id**, plus its config.
- V2's outcome labels never include `Outcome` rows derived from note-raised claim values.

**Snapshots.** Timing guard `G` (e.g. 30 days), arrival slack `S` (e.g. 30 days):

| Snapshot | Evidence dated | Computed at | For |
|---|---|---|---|
| `s0_uv` | ≤ `t_uv + G` | `t_uv + G + S` | every referral |
| `s12_uv` | ≤ `t_uv + 12 months` | `t_uv + 12 months + S` | every referral |
| `s24_uv` | ≤ `t_uv + 24 months` | `t_uv + 24 months + S` | contrarian bets only |

- **Thin starting scores.** If Jev has run an intake but found little or no output evidence, `s0` is the substance of whatever exists, down to a floor `s_floor`, and is marked **thin**. It is never treated as missing. The normal-movement fit (3.6) includes thin starts, so the typical rise from a thin start is subtracted, and referring empty profiles earns nothing by itself.
- **Late pre-referral evidence corrects `s0`.** Evidence dated ≤ `t_uv + G` that arrives after `s0` was computed triggers a **logged correction** of `s0`, and of `c_uv`, which depends on it. It also counts in later snapshots. The starting point always reflects everything that existed at referral time, so withholding evidence can't manufacture movement.
- **Standard check.** At each snapshot's compute time, every referred candidate gets the same automated public-evidence refresh (the Grok company research flow, SEA-75). Judge settlement uses **only** evidence present at a snapshot through the candidate's own submissions and this standard check, so extra effort spent on some candidates never changes their judges' rewards (3.11).
- **Timing guard:** evidence dated up to `G` after the referral counts toward the starting score.
- **Output dates:** each output is dated by when it became observable. Undated output from an in-progress role is dated by the role's `startedAt` (open decision 3).
- **Unreferred candidates** use their first Jev intake date in place of `t_uv`, with the same rules. They are needed for the fits in 3.2 and 3.6.

### 3.6 Movement against what's normal, centred dead band

For checkpoint `k ∈ {12, 24}`:

```
m_vk   = substance(s_k) − substance(s0)            // raw movement
e_k(s) = a_k + b_k·s                                // normal movement for starting substance s
r_uvk  = m_vk − e_k(s0_uv)                           // movement beyond normal
z_uvk  = (r_uvk − r̃_k) / σ_k                         // centred on the median residual, scaled by the spread
d_uvk  = sign(z_uvk) · max(|z_uvk| − h, 0)           // dead band h, in spread units
```

- **Centred dead band.** Substance rarely falls, so residuals are skewed. Centring on the median residual `r̃_k` and scaling by the spread `σ_k` stops the dead band turning noise into net positive credit, which the r7 simulation showed let a sprayer beat an early spotter. It also puts 12- and 24-month results on the same scale.
- **Frozen versions.** `e_k`, `r̃_k`, `σ_k` and `f` are fitted on candidates who have already settled, and released as numbered versions. A referral settles with the latest version released before its own settlement, which by construction doesn't include it. Each stored result records its version. A new version applies only to results stored after it.
- A candidate who goes quiet scores flat. That counts against the judge only if flat is more than `h` spreads below the median movement.

### 3.7 Accuracy fades as movement arrives

```
π_u = λ_f / (λ_f + n_settled,u)       // every settled referral counts, including dead-band results
```

Accuracy is level-based, so it rewards picking already-strong candidates. Fading it on every settled referral means long-run weight comes from spotting slope.

### 3.8 Calibration path

- **Movement gate, then ramp:**
  ```
  κ_m(t) = 0                  if K(t) < M or spread(s0) < σ_min
           κ · (1 − M / K)    otherwise
  ```
  `K(t)` is the number of club candidates with both `s0` and `s12`. Movement stays off until the fits can be identified, then ramps up from 0.
- **Judge label:** **provisional** until `N` scored signals, then **calibrated**. Label only. Admins see it with the weight.
- **Later versions**, each with its own version bump, drift report and data gate:
  - **Per-role weights** (finding where a judge is strong): role taxonomy, a defined `ŵ_{u,k}`, and a migration of `JudgeCalibration.dimension`.
  - **Credential catch-up**: for pre-credential candidates, also measure selection rising toward substance, and make normal movement depend on the gap.

### 3.9 Accepted gaps

- **Collusion.** Two judges can plan to go 1st and 2nd on a candidate. This is accepted: the symmetric stake makes it costly when the candidate doesn't deliver, and committee flags (3.12) correct exaggerated evidence.
- **Culture as the honesty incentive.** Judges aren't shown their stakes. Their personal reputation is on the line, and the symmetric stake makes the maths agree with that.
- **What evidence can't see.** Traits like resilience or unconventional range show up only in what a judge writes from firsthand knowledge, which never feeds the score. The judge's insight is rewarded later, through movement. Escrow and the 24-month checkpoint stop them being punished in the meantime.

### 3.10 What is dropped from Phase E

| Phase E piece | What replaces it |
|---|---|
| Separate scout number `Ĝ_u` | Movement term inside the single weight (3.4, 3.6) |
| `forecastKind: "will_compound"` tag | The recognition question, with a symmetric stake (3.2) |
| Prior-recognition discount `(1 − π_v)` | Position schedule and credential gap (3.2) |
| Fixed `t0`/`t1` slope window, `minGapDays` | Stored snapshots with fixed cutoffs (3.5) |
| Upside-only `max(ΔR*, 0)` | Symmetric, compressed, with stakes (3.4) |
| Surprise term in comparison selection, trajectory reporting | Not replaced. They don't move a judge's weight |

### 3.11 Anti-cohort watch

A bounded, quarterly follow-up on people the club passed over but the best judges bet on.

**Who goes on the watch:** denied or stalled candidates (no decision, or stuck at "needs data") with at least one contrarian bet, or a first-position referral from a calibrated judge. Admitted members aren't on it.

**Bounded:**

- **A fixed budget** of `B` checks per quarter (e.g. 20).
- **Priority:** `Σ over the candidate's referrals of ω_u · b_uv · c_uv`, i.e. how strongly the club's best judges bet on them.
- **Leaving the watch:** after 36 months, after two flat checks in a row, or once a check finds them risen (a resolved regret case).

**Committee checks:**

- Each quarter's budget is split across organising-committee members on a rotation.
- **Recusal:** no one checks a candidate they referred or voted on.
- **Predict, then look.** Before looking anything up, the checker records a prediction (rose, flat or fell). Afterwards it's compared with what they found. This builds each committee member's track record on exactly the people the club passed over, and it is the point of the exercise: improving the committee's judgement.
- **Sourced facts only.** Checkers add what they find as `committee`-authored sourced facts (3.5), and may flag exaggerated claims (3.12). No opinions.
- Checks need no cooperation from the candidate, so people who don't respond are still covered.

**What the checks feed, and what they don't:**

| Feeds | Never feeds |
|---|---|
| **Releasing escrow:** a check finding the person rose releases the judge's held contrarian debit | **Judge rewards.** Movement rewards come only from the standard check (3.5). Extra effort can release a penalty, never create a reward |
| **Regret report:** each denied-then-rose case with its decision snapshot (what the council saw) and which signals pointed the right way (judge bets, gap, position); plus the denial-regret rate by credential level, which measures council credential bias | **Committee members' judge weights.** Checking track records stay in a separate committee calibration report |
| **Reopen suggestions** for admins. Nothing reopens automatically | |
| **Committee calibration report:** predictions against findings, per checker | |

The regret and calibration reports are engine analysis functions (`src/analysis/antiCohort.ts`), exploratory like `underRecognition.ts`. The club app renders them and runs the quarterly job.

### 3.12 Committee correction of exaggerated claims

A committee checker, on the watch or in normal review, can **flag** a claim as unsupported or exaggerated, for example a launch that didn't happen or a role smaller than described.

- A flag must cite a source.
- The checker can't be a judge who referred the candidate, and recusal applies.
- A flag lowers only that claim's backing in Jev. It never changes a person's score directly and never adds value.
- Flags are logged and reversible by another committee member with a source.

This is the correction mechanism that coached evidence needs. The r7 simulation showed that without it, colluders who coach outrank honest spotters.

---

## 4. Delivery order

Each step is its own PR and can be verified on its own:

0. **Simulation harness** (PR #116, built for r7). Update it to r8 and add S6 (§5).
1. **Weight scale.** `μ0`, `γ`, the soft cap, the log-odds form with only the accuracy term, the V2 compatibility branch, and `judgeWeighting` using `ω_u`. Register `judge_reliability@4.0.0` with a drift report.
2. **Admission, position and recognition.** `decidedBy`, per-referrer leave-one-judge-out signals on decision snapshots, the recognition question, position ranking, `q_uv` without the gap, `ℓᴬ`, escrow. This delivers goal 1. Its own version and drift report.
3. **Evidence-only substance.** `author` field (including committee sourced facts) and runtime validator, committee flags, `outputOnlyRollup`, output dating, sorted hashing, the truth-label guard. No weight changes.
4. **Stored snapshots.** `s0` (including thin starts), `s12`, `s24` for contrarian bets, the standard check, and the logged correction operation, on referrals and on unreferred candidates' intake. No weight changes.
5. **Movement, settlement, gap and fading.** Versioned fits, the centred dead band, compression, stakes and settlement, the credential gap, the accuracy fade, the gate and ramp, the judge label. Its own version and drift report.
6. **Anti-cohort watch.** Watch selection and budget, committee rotation and recusal, predict-then-look, escrow release, the regret and committee calibration reports, reopen suggestions.
7. **Credential catch-up.** Its own version and drift report.

## 5. Simulation scenarios

Synthetic clubs with known judge skill, run through the whole pipeline. Each scenario states its data-generating process before it runs. r7 results are from PR #116 at its chosen parameters.

| # | Scenario | Pass if | r7 result |
|---|---|---|---|
| S1 | **Best case:** honest, skilled judges, fair council | Skill order recovered (Spearman ≥ 0.7 at 36 months, ≥ 0.5 at 12) | pass, thin margin (0.75) |
| S2 | **Mostly good:** plus a consensus-picker | Consensus-picker ends below early spotters of equal accuracy | pass |
| S3 | **Mixed:** early spotter, consensus-picker, sprayer, noisy judge, slow evidence | Skill order recovered; the sprayer ends below every honest judge | pass |
| S4 | **Adversarial:** colluding pair, coached evidence, withheld evidence, credential-biased council. **r8 adds committee flags at a stated detection rate** | Colluders don't outrank honest spotters; withheld evidence never creates movement; denied-but-rose judges gain | 2 fails, at every parameter set |
| S5 | **Worst case:** most judges game, council follows visible weight, little evidence, tiny cohort | Bounds hold; no runaway; movement off below the gate | pass |
| S6 | **Out of distribution (new):** thin, unconventional evidence, a credential-biased council that denies them, heavy-tailed rises arriving over 18–36 months. Run with the anti-cohort watch on and off | Judges who back them end above consensus-pickers by month 36; escrow keeps them from dropping below `μ0` in the meantime; the regret report finds most denied-then-rose cases within its budget | new |

Parameters are chosen as the values that pass S1–S4 and S6 with the widest margin and keep S5 within bounds.

## 6. Invariants (tests)

- **V2 compatibility:** `mode: "v2"` returns V2's outputs exactly. Runs still on V2 keep their golden run ids.
- **Bounds:** `w_u` and `ω_u` are always strictly inside (0, 1), including in floating point, and `judgeWeighting` never throws.
- **Per-event bound:** every kind of event (adding, settling, correcting or re-settling a referral, an accuracy update, a ramp step, an escrow release) changes any judge's `logit w` by at most a stated bound.
- **Recusal:** a decision the judge took part in never gives that judge admission credit.
- **No self-caused credit:** an admission that rested entirely on judge `u` (`ρ = 1`) gives `u` no early credit.
- **Denials:** a denial's early debit doesn't depend on `ρ`.
- **Escrow:** a denied contrarian bet's debit is not applied before settlement or release.
- **Release, never reward:** committee findings can change an escrowed debit to 0 but can never raise a judge's weight above what it would be without them.
- **No permanent credit:** a referral without `s0` never carries admission credit.
- **Settlement:** after a referral settles, its admission credit is gone and only its movement term remains.
- **Position:** with everything else equal, an earlier position earns at least as much as a later one, for rewards and penalties alike.
- **Symmetric bets:** for any recognition answer, the reward for a rise and the penalty for an equal fall have the same size.
- **No drift from the dead band:** with movement drawn from the fitted normal, the expected `d` is 0 for any `h`.
- **Compression:** a larger rise always earns at least as much as a smaller one, up to the per-referral backstop.
- **No judge input:** referrer notes, referrer-authored claims, a `trend` value, an admission decision or a recognition answer never change `evidenceScore`.
- **Committee input:** a committee claim without a source is rejected; a committee flag never raises `evidenceScore`.
- **Truth labels:** V2 outcome labels never include rows derived from note-raised claim values.
- **No manufactured movement:** withholding pre-referral evidence and submitting it later gives the same movement result as submitting it on time.
- **Equal effort:** anti-cohort checks never change any judge's movement reward.
- **Arrival order:** the same evidence in different batches or orders gives the same snapshots, after corrections, and the same hashes.
- **Refit:** a new fit version never changes an already-stored result.
- **Fade:** `π_u` falls monotonically with every settled referral.
- **Gate:** below `M`, or with too little spread in starting scores, the movement term is 0.
- **Watch budget:** a quarter never schedules more than `B` checks, and no checker is assigned a candidate they referred or voted on.
- **Committee separation:** a committee member's checking record never changes their judge weight.
- **Simulations:** S1–S6 pass (§5).

## 7. Open decisions

1. **Parameter values:** `μ0 = 0.3` and `γ = 2` are chosen. The rest come from the simulations: `T`, `α`, `φ`, `β_g`, `c_min`, `c_max`, `g0`, the `b` values, `β`, `D`, `G`, `S`, `h`, `s_floor`, `κ_a`, `κ`, `Lᴬ`, `Lᴹ`, `M`, `σ_min`, `N`, `λ`, `λ_f`, `B`.
2. **Fade padding:** a judge with poor accuracy could speed up the fade with many unremarkable referrals. Each one needs a real candidate with evidence over 12 months. Is that enough, or should the fade also be capped by time?
3. **Undated in-progress output:** dating it by the role's `startedAt` can miss real growth in a long-running role. To be decided later.
4. **Watch size and cadence:** `B` per quarter, and how many checks each committee member can reasonably do.
5. **Display bands** (C … A) for admins: separate from this spec.
6. **Referral-volume signal** (many referrals plus passing evaluations means a name is spreading): a candidate signal, tracked separately.

## 8. Review history

- **Round 1 (Codex, r1):** free bet on candidates without evidence; import-only circularity guard; unfair steps at ladder ends; hysteresis needed history; impossible run-id invariant.
- **Round 2 (Codex, r2):** padding helped negative judges; note-raised values reached the rollup; "latest score" moved old results; grace-period lookahead; band-only expectation; mutable role mix.
- **Self-review (r3):** padding through non-moving referrals; referrer-added claims; arrival order; refits moved old results.
- **Round 3 (Kimi K3 max, Grok 4.7 xhigh, r4):** weight above 1; shrinkage toward 1; version clash; V2 description; judge inputs; hash order; resume-date exploit; hidden truth-label path; coached evidence; undefined per-role; mixed horizons; winner's curse; minimum cohort; `h` units; timing; value vs substance; name clash.
- **Round 4 (Codex, r5):** late evidence manufactured movement; accuracy rewarded credentialism; no early calibration; abrupt club gate; goal 2 not delivered; V2 equivalence false at `p̂ = 1`.
- **Round 5 (Codex, r6):** admission fed itself; permanent unsettled credit; ramp before the fit; fade missed normal movers; settlement repriced history; no consensus discount.
- **Round 6 (simulation, r7; PR #116), the "Out of Distribution" essay, and Sean's decisions, handled in r8:**
  - Dead band drifted upward on skewed movement → centred on the median residual, in spread units (3.6).
  - Withheld evidence still created movement → late pre-referral evidence corrects `s0` (3.5).
  - Coaching decided S4 → committee flags (3.12), and S4 models them.
  - No volume cap; weights saturated near 1 → soft cap `T·tanh(Σ/T)` (3.1).
  - `ρ` ignored the decision's direction → admissions only; denials carry the full debit (3.3).
  - Per-event bound missed accuracy updates and ramp steps → covers every event kind (§6).
  - Spec gaps the simulation surfaced → recusal keeps position and settles at stake 1; factors fixed at `t + max(D, G+S)`; post-decision referrals get no admission credit; gap per referral; frozen fit versions instead of per-candidate leave-one-out; the ramp simplified (3.2–3.8).
  - Credential-biased councils punish contrarian judges early → escrow (3.3).
  - Caps cut off breakouts → compression `ψ` (3.4).
  - Late bloomers → 24-month checkpoint for contrarian bets (3.4, 3.5).
  - Thin evidence was invisible → thin starting scores (3.5).
  - People the club passed over → anti-cohort watch with committee checks: predict then look, sourced facts only, release but never reward (3.11).
  - No out-of-distribution test → S6 (§5).

## 9. Questions for reviewers (round 7)

1. **Out of distribution:** read against the "Out of Distribution" essay, does r8 reward the judges who spot people who look like bad bets on paper? Where does it still favour credentials?
2. **Escrow:** can a judge game "contrarian bet" status, e.g. by answering "Not yet" on everyone to avoid early debits? The symmetric stake makes "Not yet" a bigger loss on a flop. Is that enough?
3. **Thin starting scores:** does including thin starts in the normal-movement fit stop "refer empty profiles and wait for any evidence" from paying?
4. **Release, never reward:** is it right that committee findings can only release penalties? Does that leave out-of-distribution judges under-rewarded when only the committee can see the rise?
5. **Committee flags:** can a committee member use flags to damage a candidate, or a judge, they dislike? Are a cited source plus logging and reversal enough?
6. **Watch priority:** does prioritising by the best judges' bets entrench those judges, since they get more of their misses checked?
7. **Anything still gameable or circular.**
