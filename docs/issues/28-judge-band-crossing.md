# Judge weights from admission, accuracy and movement (revision 7, replaces Phase E)

**Status:** revision 7 (r7) of the spec, for review. Not implemented. The Linear doc is the source of truth; this file is a copy so Codex and the PR reviewers can review it as a diff. "Revision" numbers the doc; the engine version it ships as is `judge_reliability@4.0.0`.
**Replaces:** #20–#27 (Phase E). That work was merged into `cursor/judge-calibration-demo-5d70` and never reached `main`. It is not ported.
**Builds on:** V2 judge calibration (`judge_reliability@2.0.0`, `src/judges/reliability.ts`), Referral Signal weighting (`src/scoring/weighting.ts`), Club decisions and referral questions (`Decision`, `ClubSnapshot` in `apps/club/lib/types.ts`; SEA-62), and the Jev claim and rollup modules (`src/longitudinal/claimValue.ts`, `claimPreprocess.ts`, `personRollup.ts`).
**Spec versions touched:** registers `judge_reliability@4.0.0` (3.0.0 is reserved by Phase E's `docs/issues/20`). Each delivery step that changes numbers gets its own version and drift report.

---

## 0. Goals

1. **Calibrate a judge's weight as soon as possible.** Served by the admission signal (3.3), which arrives within weeks.
2. **Once calibrated, change smoothly over time.** Served by fixed, capped per-referral contributions (3.1), settlement one referral at a time (3.4), the dead band (3.6), the gated ramp (3.8), and frozen stored results (3.5). **Finding where a judge is strong** (per-role weights) comes in a later version (3.8).
3. **Reward spotting slope over credentialism and consensus bets.** Served by:
   - the position schedule: the first judge to back someone earns the most (3.2);
   - the credential gap: backing someone whose substance is ahead of their credentials is worth more than backing an already-credentialed pick (3.2);
   - the recognition question: a judge's explicit "not yet recognised" is a bigger bet (3.2);
   - movement on substance, measured against normal for the starting score (3.6);
   - accuracy fading as movement data arrives (3.7);
   - settlement: admission credit is temporary and replaced by what the candidate did (3.4).

## 1. Summary

People in the club refer candidates. Each referrer ("judge") has a **weight** in (0, 1) for how much their referrals count. Three signals feed it, each arriving later than the last:

| Signal | Arrives | Role |
|---|---|---|
| **Admission** (council admits or denies the referred candidate) | weeks | early calibration, credited now and settled later |
| **Accuracy** (V2: did the referral's strength match outcomes) | 6 months | middle term, fades as movement arrives |
| **Movement** (did the candidate's evidence-backed substance rise beyond normal) | 12 months | the long-run signal: spotting slope |

**Credit now, settle later.** When the council decides on a judge's candidate, the judge gets early credit or debit. When the candidate's 12-month movement result arrives, it replaces that early credit:

- **Admitted and rose:** rewarded. The more the council relied on this judge, the larger the stake.
- **Admitted and flopped:** the early credit is taken back and replaced by a penalty with the same larger stake. People trusted the referral and it broke.
- **Denied and rose:** rewarded at the ordinary stake. The council missing someone is not a failure of the judge.
- **Denied and flopped:** an ordinary penalty, since nothing was acted on.

**Every referral's credit is scaled by three things fixed at referral time:**

- **Position:** the 1st judge to back a candidate is the advocate, the 2nd validates, and the 10th is confirming what's already known.
- **Credential gap:** whether the candidate's substance was ahead of their credentials (pre-credential) or not (consensus).
- **Recognition answer:** the judge's own call on whether the candidate has been recognised yet.

Rules that keep it hard to game and stable over time:

- The candidate score is built **only from evidence judges didn't write**.
- Every value has **fixed cutoffs and is stored once**. Later reruns, late evidence and reopened decisions never move old results.
- A judge never gets credit from a decision they took part in, or from an admission their own weight caused.
- Each referral adds a **fixed, capped** amount to a judge's weight, so no single event reprices a judge's history.

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

**Jev** turns a candidate's career claims into claim values. Every job is split into **selection** claims (getting hired somewhere selective: credentials) and **output** claims (what the person did: substance). The rollup produces `consensus`, `substance`, `value` and `alpha` per person (`personRollup.ts`). Paths by which judges can influence Jev today or soon:

- `consensus = selectionAggregate + wTrend · trend`, where `trend` is caller-supplied with no provenance check.
- In `career_evidence@1.2.0`, a `ReferrerNote` lifts a claim's backing from self-reported to corroborated (`claimValue.ts`).
- Referrer-added claims (SEA-61) are planned, not implemented.
- `claimValuesToLongitudinalRecords` (`claimValue.ts:272`) can turn note-raised claim values into `Outcome` rows. It has no callers yet.

---

## 3. Design

### 3.1 Weight scale

Each judge's weight is a starting point plus a sum of **fixed per-referral contributions** in log-odds:

```
logit w_u = logit μ0                                      // μ0 = 0.3: new judges start here
          + Σ_{unsettled uv} ℓᴬ_uv                        // admission credit (3.3)
          + π_u · (logit p̂⁰_u − logit μ0)                 // accuracy, fading share (3.7)
          + κ_m(t) · Σ_{settled uv} ℓᴹ_uv                 // movement results (3.4, 3.6)
ω_u = w_u^γ                                               // γ ≥ 1, start γ = 2
contribution_uv = ω_u · R_uv                              // what Referral Signal uses
```

- `p̂⁰_u` is V2 accuracy shrunk toward `μ0` instead of 1, clamped to `[ε, 1−ε]` before `logit`.
- Every `ℓ` is computed once per referral and capped: `|ℓᴬ_uv| ≤ Lᴬ`, `|ℓᴹ_uv| ≤ Lᴹ`. There are no shared denominators, so adding, settling or removing one referral changes only that referral's term.
- `w_u` stays strictly inside (0, 1), so `judgeWeighting` never throws.
- `ω_u = w^γ` makes high weights count more. At γ = 2: 0.3 → 0.09, 0.6 → 0.36, 0.9 → 0.81.
- Sums resist padding on their own: a referral that adds 0 changes nothing.
- **V2 compatibility branch:** a spec flag `mode: "v2"` returns V2's `p̂_u` unchanged, including `p̂ = 1` for judges with no data.

### 3.2 What each referral is worth: position, gap, recognition

Three factors are fixed when the referral is made and stored with it.

**Position** (the judge's timing). A candidate's eligible referrals are ranked by `createdAt`, counting distinct judges and each judge's earliest referral. Self-referrals, duplicates and recused referrals don't take a position. Ties on the same day share the average of their positions.

```
share(k) = max(φ, 1 / k^α)        // e.g. α = 0.75, φ = 0.2: 1st 1.0, 2nd 0.6, 3rd 0.44, 4th 0.35, … floor 0.2
```

**Credential gap** (whether the candidate was obvious from credentials). From the evidence-only starting snapshot (3.5):

```
gap_v = substance(s0) − f(selection(s0))      // f: expected substance given credentials, a frozen, versioned fit
c_v   = clip(1 + β_g · gap_v, c_min, c_max)   // gap > 0: pre-credential, stake up; gap < 0: consensus, stake down
```

- `f` is fitted on all club candidates, leaving out the candidate being scored, and frozen and versioned like `e` (3.6).
- Display labels for admins: **pre-credential** (`gap_v ≥ g0`), **consensus** (high selection and `gap_v ≤ −g0`), **neither** otherwise. The labels never feed the math; `c_v` is continuous, so there is no boundary to cluster at.

**Recognition answer** (the judge's own bet). A new referral question:

> **Has this person received the recognition their ability deserves?**
> Not yet · Soon (within a year) · Yes, already · Not sure

```
b_uv = b_notyet (e.g. 1.5) | b_soon (1.25) | b_yes (0.25) | 1 for "Not sure" or no answer
```

- The answer is the judge's prediction, never evidence. It never feeds `evidenceScore`.
- It is frozen at referral time. Old test referrals count as "Not sure".
- The stake is symmetric: a bigger bet means a bigger reward and a bigger loss.

**Per-referral weight:**

```
q_uv = share(k_uv) · c_v · b_uv
```

### 3.3 Admission signal (early calibration)

For referral `u → v` at `t_uv = referral.createdAt`:

```
a_uv  = +1 if the decision standing on v at t_uv + D is "admit", −1 if "deny", unscored otherwise
ρ_uv  = clip( (S_v − S_v^{−u}) / S_v, 0, 1 )      // how much of the signal the council saw came from judge u
ℓᴬ_uv = clip( κ_a · q_uv · a_uv · (1 − ρ_uv), −Lᴬ, Lᴬ )
```

- **Leave-one-judge-out:** each decision snapshot records, for every referrer, the Referral Signal **without** that referrer, `S_v^{−u}`, next to the full signal `S_v`. Early credit is scaled by `(1 − ρ_uv)`: a judge gets credit only for the part of the decision their own weight didn't cause. This breaks the loop where weight causes admission, which raises weight.
- **Fixed date:** the decision counted is the one standing at `t_uv + D` (e.g. `D` = 60 days). A later `reopen` or reversal never changes it, except through a logged correction.
- **Recusal:** decisions get a new `decidedBy` field listing every admin who took part. A judge gets no admission credit from a decision they took part in.
- **Starting score required:** admission credit applies only once the referral has a starting snapshot `s0` (3.5). With none by `s0`'s compute time, the credit never applies, so there is no unsettled credit that lasts forever.
- **Admins see** each judge's weight and each referral's recognition answer. Members never see judge weights. Leave-one-judge-out keeps the visible weight from earning its owner credit.

### 3.4 Settlement: movement replaces admission credit

When referral `u → v` gets its movement result `d_uv` (3.6), its `ℓᴬ_uv` is removed and its movement term is added:

```
stake_uv = 1 + (β − 1) · ρ_uv     if admitted     // β > 1: the more the council relied on u, the larger the stake
           1                      otherwise
ℓᴹ_uv    = clip( q_uv · stake_uv · d_uv, −Lᴹ, Lᴹ )
```

| Admission | Movement | Effect on the judge |
|---|---|---|
| admitted | rose beyond normal | early credit replaced by a reward, scaled up by reliance |
| admitted | fell beyond normal | early credit taken back and replaced by a penalty, scaled up by reliance |
| denied | rose beyond normal | early debit replaced by an ordinary reward: the council missed it, the judge didn't |
| denied | fell beyond normal | early debit replaced by an ordinary penalty |
| either | inside the dead band | early credit removed, nothing added |

- Settlement happens once per referral and changes only that referral's terms. The fade (3.7) shifts at the same moment. A per-event bound covers both.
- The leave-one-judge-out split works in both directions. Early credit counts only what the judge didn't cause (`1 − ρ`). At settlement, the judge answers for what the council took on their word (`ρ`).

### 3.5 Evidence-only substance, fixed cutoffs

`evidenceScore(v, cutoffs)` is Jev **substance** and selection, computed by a new `outputOnlyRollup`. Substance, not value, for movement: value includes consensus, which counts missing selection evidence as 0 and jumps on hire dates.

**Judge-free input:**

- Input is provenance-tagged raw Jev judgments, never finished `claimValue` numbers. Claim values are recomputed with referrer notes switched off.
- Every claim gets a new `author` field (`candidate | referrer | committee | system`), separate from `source: SourceKind`. Only `candidate` and `system` claims are accepted, enforced by a runtime validator.
- No `trend` parameter. It never reads comparisons, Referral Signal, admission decisions, recognition answers, or anything downstream of judge weights.
- Each result records `hashInputs` of its input claims **sorted by claim id**, plus its config.
- V2's outcome labels never include `Outcome` rows derived from note-raised claim values.

**Two cutoffs per snapshot.** Each snapshot has an **evidence cutoff** (the date the evidence describes) and an **ingestion cutoff** (when the evidence reached us). Timing guard `G` (e.g. 30 days), arrival slack `S` (e.g. 30 days):

| Snapshot | Evidence dated | Ingested by | Stored at |
|---|---|---|---|
| `s0_uv` | ≤ `t_uv + G` | `t_uv + G + S` | `t_uv + G + S` |
| `s12_uv` | ≤ `t_uv + 12 months` | `t_uv + 12 months + S` | `t_uv + 12 months + S` |

- **No manufactured movement:** `s12` excludes evidence dated ≤ `t_uv + G` that was ingested after `s0` was stored. Such evidence is logged and counted in neither snapshot.
- **Timing guard:** evidence dated up to `G` after the referral counts toward the starting score, so referring someone just before an event you already know about earns nothing.
- **Output dates:** each output is dated by when it became observable (its own date, or `endedAt`). Undated output from an in-progress role is dated by the role's `startedAt` (open decision 3).
- Stored snapshots are never recomputed. Changing one is an explicit, logged correction.
- **Unreferred candidates** use their first Jev intake date in place of `t_uv`, with the same rules. They are needed for the fits in 3.2 and 3.6.

### 3.6 Movement against what's normal for the starting score

```
m_v    = substance(s12) − substance(s0)     // raw movement
e(s)   = a + b·s                            // normal movement for starting substance s (pooled line)
r_uv   = m_v − e(s0_uv)                     // movement beyond normal
d_uv   = sign(r_uv) · max(|r_uv| − h, 0)    // dead band, h in absolute substance units
```

- `e` is fitted on all club candidates with both snapshots, referred or not, **leaving out the candidate being scored**.
- `e` is **frozen and versioned**. Each stored result records the `e` version it used. A refit is a new version with a drift report and applies only to results stored after it.
- A candidate who goes quiet scores flat. That counts against the judge only when `e(s0) > h`; otherwise it falls inside the dead band.

### 3.7 Accuracy fades as movement arrives

```
π_u = λ_f / (λ_f + n_settled,u)       // every settled referral counts, including dead-band results
```

- Accuracy is level-based, so it rewards picking already-strong candidates. Fading it on every settled referral means a judge whose picks all move normally still loses the accuracy term, so long-run weight comes from spotting slope.

### 3.8 Calibration path

- **Movement gate, then ramp:**
  ```
  κ_m(t) = 0                          if K(t) < M or spread(s0) < σ_min
           κ · (K − M) / (K − M + M)  otherwise
  ```
  `K(t)` is the number of club candidates with both snapshots. Movement stays off until the line `e` and the fit `f` can be identified (enough candidates and enough spread in starting scores). It then ramps up from 0, so there is no jump at `M`.
- **Judge label:** **provisional** until `N` scored signals (admission, accuracy or movement), then **calibrated**. Label only. Admins see it with the weight.
- **Later versions**, each with its own version bump, drift report and data gate:
  - **Per-role weights** (finding where a judge is strong): role taxonomy, a defined `ŵ_{u,k}`, and a migration of `JudgeCalibration.dimension`. It shrinks toward the judge's overall weight.
  - **Extra movement checkpoints** (6 and 24 months): needs a rule for mixed horizons.

### 3.9 Accepted gaps

- **Coached resumes.** Evidence a judge helped write enters as ordinary evidence. This is accepted: coaching that represents real work candidly is fine, and evaluators outside the judge's circle correct exaggerations through evaluations and comparisons.
- **Collusion.** Two judges can plan to go 1st and 2nd on a candidate. This is accepted, on the same reasoning: the symmetric stake makes it costly when the candidate doesn't deliver, and outside evaluators correct the rest.
- **Culture as the honesty incentive.** Judges aren't shown their stakes. They know their personal reputation is on the line, and the club wants people who are both strong and good to be around. The symmetric stake makes the maths agree with that incentive.

### 3.10 What is dropped from Phase E

| Phase E piece | What replaces it |
|---|---|
| Separate scout number `Ĝ_u` | Movement term inside the single weight (3.4, 3.6) |
| `forecastKind: "will_compound"` tag | The recognition question, with a symmetric stake (3.2) |
| Prior-recognition discount `(1 − π_v)` | Position schedule and credential gap (3.2) |
| Fixed `t0`/`t1` slope window, `minGapDays` | Stored snapshots with fixed cutoffs (3.5) |
| Upside-only `max(ΔR*, 0)` | Symmetric, with stakes (3.2, 3.4) |
| Surprise term in comparison selection, trajectory reporting | Not replaced. They don't move a judge's weight |

---

## 4. Delivery order

Each step is its own PR and can be verified on its own:

0. **Simulation harness.** A pure model of the r7 maths, run on five scenarios (§5), used to set the parameters. It also runs the fairness invariants. No production changes.
1. **Weight scale.** `μ0`, `γ`, the log-odds form with only the accuracy term, the V2 compatibility branch, and `judgeWeighting` using `ω_u`. Register `judge_reliability@4.0.0` with a drift report.
2. **Admission, position and recognition.** `decidedBy` and per-referrer leave-one-judge-out signals on decision snapshots, the recognition question, position ranking, `q_uv` without the gap, and `ℓᴬ`. This delivers goal 1. Its own version and drift report.
3. **Evidence-only substance.** `author` field and runtime validator, `outputOnlyRollup`, output dating, sorted hashing, the truth-label guard. No weight changes.
4. **Stored snapshots.** `s0` and `s12` with evidence and ingestion cutoffs, on referrals and on unreferred candidates' intake, plus the logged correction operation. No weight changes.
5. **Movement, settlement, gap and fading.** `e` and `f` fitting and versioning, the credential gap `c_v`, the dead band, stakes and settlement, the accuracy fade, the gate and ramp, the judge label. Its own version and drift report.
6. **Credential catch-up.** For pre-credential candidates, also measure selection rising toward substance, and make normal movement depend on the gap as well as the starting score. Its own version and drift report.

## 5. Simulation scenarios (delivery step 0)

Synthetic clubs with known judge skill, run through the whole r7 pipeline, including the council, evidence arrival and movement. Each scenario states its data-generating process before it runs.

| # | Scenario | What it contains | Pass if |
|---|---|---|---|
| S1 | **Best case** | Honest, skilled judges. Fair council. Evidence arrives on time. | True skill order is recovered (rank correlation ≥ a stated threshold) within a stated time. |
| S2 | **Mostly good** | As S1, plus one consensus-picker who only refers already-credentialed people. | The consensus-picker ends below early spotters of equal accuracy. |
| S3 | **Mixed** | Early spotter, consensus-picker, sprayer (refers everyone first), noisy judge, slow-evidence candidates. | Skill order recovered. The sprayer doesn't gain from first positions. |
| S4 | **Adversarial** | Colluding pair taking 1st and 2nd, coached evidence, withheld pre-referral evidence, a council biased toward credentials. | Gamers don't outrank honest spotters. Withheld evidence never creates movement. Denied-but-rose judges still gain. |
| S5 | **Worst case** | Most judges game, the council follows the visible weight, little evidence, a tiny cohort near `M`. | No weight leaves (0, 1). No single event exceeds the per-event bound. The loop doesn't run away: weights stay near `μ0` rather than spiralling. Movement stays off below the gate. |

Parameters are chosen as the values that pass S1–S4 with the widest margin and keep S5 within bounds.

## 6. Invariants (tests)

- **V2 compatibility:** `mode: "v2"` returns V2's outputs exactly. Runs still on V2 keep their golden run ids.
- **Bounds:** `w_u` and `ω_u` are always in (0, 1), and `judgeWeighting` never throws.
- **Per-event bound:** settling, adding or correcting one referral changes any judge's `logit w` by at most a stated bound, including the simultaneous fade shift.
- **Recusal:** a decision the judge took part in never changes that judge's weight.
- **No self-caused credit:** if the council's decision rested entirely on judge `u` (`ρ = 1`), `u`'s early admission credit is 0.
- **Fixed decision date:** reopening or reversing a decision after `t_uv + D` never changes any weight, except through a logged correction.
- **No permanent credit:** a referral without a starting snapshot never carries admission credit.
- **Settlement:** after a referral settles, its admission credit is gone and only its movement term remains.
- **Position:** with everything else equal, an earlier position earns at least as much as a later one, for rewards and penalties alike.
- **Symmetric bets:** for any recognition answer, the reward for a rise and the penalty for an equal fall have the same size.
- **No judge input:** adding referrer notes, referrer- or committee-authored claims, a `trend` value, an admission decision or a recognition answer never changes `evidenceScore`.
- **Truth labels:** V2 outcome labels never include rows derived from note-raised claim values.
- **No manufactured movement:** pre-referral evidence ingested after `s0` is stored never changes `s12` or any weight.
- **Arrival order:** the same evidence in different batches or orders gives the same stored snapshots and hashes.
- **Refit:** a new `e` or `f` version never changes an already-stored result.
- **Fade:** `π_u` falls monotonically with every settled referral, including dead-band ones.
- **Gate:** below `M`, or with too little spread in starting scores, the movement term is 0.
- **Simulations:** S1–S5 pass (§5).

## 7. Open decisions

1. **Parameter values:** `μ0 = 0.3` and `γ = 2` are chosen. The rest come from the simulations: `α`, `φ`, `β_g`, `c_min`, `c_max`, `g0`, the `b` values, `β`, `D`, `G`, `S`, `h`, `κ_a`, `κ`, `Lᴬ`, `Lᴹ`, `M`, `σ_min`, `N`, `λ`, `λ_f`.
2. **Fade padding:** fading accuracy on every settled referral means a judge with poor accuracy could speed up the fade with many unremarkable referrals. Each one needs a real candidate with evidence over 12 months, so it's costly. Is that enough, or should the fade be capped by time as well?
3. **Undated in-progress output:** dating it by the role's `startedAt` can miss real growth in a long-running role. To be decided later.
4. **Display bands** (C … A) for admins: separate from this spec.
5. **Referral-volume signal** (many referrals plus passing evaluations means a name is spreading): a candidate signal, tracked separately.

## 8. Review history

- **Round 1 (Codex, r1):** free bet on candidates without evidence; import-only circularity guard; unfair steps at ladder ends; hysteresis needed history; impossible run-id invariant.
- **Round 2 (Codex, r2):** padding helped negative judges; note-raised values reached the rollup; "latest score" moved old results; grace-period lookahead; band-only expectation; mutable role mix.
- **Self-review (r3):** padding through non-moving referrals; referrer-added claims; arrival order; refits moved old results.
- **Round 3 (Kimi K3 max, Grok 4.7 xhigh, r4):** weight above 1; shrinkage toward 1; version clash; V2 description; judge inputs; hash order; resume-date exploit; hidden truth-label path; coached evidence; undefined per-role; mixed horizons; winner's curse; minimum cohort; `h` units; timing; value vs substance; name clash.
- **Round 4 (Codex, r5):** late evidence manufactured movement; accuracy rewarded credentialism; no early calibration; abrupt club gate; goal 2 not delivered; V2 equivalence false at `p̂ = 1`.
- **Round 5 (Codex, r6) and Sean's decisions, handled in r7:**
  - Admission feeds itself → leave-one-judge-out: early credit scaled by `1 − ρ`, settlement stake by `ρ` (3.3, 3.4).
  - Unsettled credit lasts forever → admission credit requires a starting snapshot (3.3).
  - Ramp before the line can be fitted → hard gate on `M` and spread, then a ramp from 0 (3.8).
  - Accuracy doesn't fade for normal movers → fade on every settled referral (3.7).
  - One settlement reprices history → fixed, capped per-referral contributions (3.1).
  - Nothing discounts consensus bets → position schedule, credential gap, recognition question (3.2).
  - Denied and rose → rewarded at the ordinary stake (3.4).
  - Admins see judge weights and recognition answers (3.3).
  - Coaching and collusion → accepted gaps, with reasons (3.9).
  - Simulations → delivery step 0, five scenarios (§5).
  - No real data → no migration (§2).

## 9. Questions for reviewers (round 6)

1. **Leave-one-judge-out:** does scaling early credit by `1 − ρ` and the settlement stake by `ρ` remove the loop, or only shrink it? What about several high-weight judges backing the same candidate?
2. **Position schedule:** does `share(k)` create a race to refer first that outweighs the symmetric penalty? How should ties and near-ties be handled?
3. **Credential gap:** is `substance − f(selection)` a fair way to separate pre-credential from consensus candidates, given that Jev may see little evidence for exactly the people judges are best at spotting?
4. **Recognition bet:** do the `b` values make honest answers the best strategy, given that judges aren't shown their stakes?
5. **Fixed per-referral sums:** without averaging, a prolific judge's weight can move further than an occasional judge's. Is that right, or should the sums be scaled by volume?
6. **Simulations:** are the five scenarios and their pass criteria strong enough to set the parameters?
7. **Anything still gameable or circular.**
