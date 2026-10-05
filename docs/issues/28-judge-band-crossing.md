# Judge weights from admission, accuracy and movement (revision 9, replaces Phase E)

**Status:** revision 9 (r9) of the spec, for review. Not implemented. The Linear doc is the source of truth; this file is a copy so Codex and the PR reviewers can review it as a diff. "Revision" numbers the doc; the engine version it ships as is `judge_reliability@4.0.0`.
**Replaces:** #20–#27 (Phase E). That work was merged into `cursor/judge-calibration-demo-5d70` and never reached `main`. It is not ported.
**Builds on:** V2 judge calibration (`judge_reliability@2.0.0`, `src/judges/reliability.ts`), Referral Signal weighting (`src/scoring/weighting.ts`), Club decisions and referral questions (`Decision`, `ClubSnapshot` in `apps/club/lib/types.ts`; SEA-62), the Jev claim and rollup modules (`src/longitudinal/claimValue.ts`, `claimPreprocess.ts`, `personRollup.ts`), and the exploratory under-recognition diagnostic (`src/analysis/underRecognition.ts`).
**Simulation:** step 0 is built in PR #116 (`bun run sim:judges`). Its r7 and r8 results drove most of the changes here.
**Grounding:** Rich Zou, ["Out of Distribution"](https://richzou.com/essays/out-of-distribution). The best people often look like bad bets on paper (thin or "incoherent" records, unconventional paths) and are rejected by evaluators who pattern-match on credentials. This spec aims to reward the judges who spot them.
**Spec versions touched:** registers `judge_reliability@4.0.0` (3.0.0 is reserved by Phase E's `docs/issues/20`). Each delivery step that changes numbers gets its own version and drift report.

---

## 0. Goals

1. **Calibrate a judge's weight as soon as possible.** Served by the admission signal (3.3), which arrives within weeks.
2. **Once calibrated, change smoothly over time.** Served by the soft cap and per-referral contributions (3.1), settlement one referral at a time (3.4), the smooth noise curve with a neutral centre (3.6), the gated ramp (3.8), and frozen stored results (3.5). **Finding where a judge is strong** (per-role weights) comes in a later version (3.8).
3. **Reward spotting slope over credentialism and consensus bets, including out-of-distribution people.** Served by:
   - the position schedule, credential gap and recognition bet (3.2);
   - escrow for denied candidates whose substance is ahead of their credentials, so a credential-biased council can't punish a judge before the evidence is in (3.3);
   - settlements at 12, 24 and 36 months for those candidates, so late bloomers count (3.4);
   - thin starting scores, so people with little conventional evidence can still be scored (3.5);
   - accuracy fading as movement data arrives (3.7).

   Separately from judge weights, the **anti-cohort watch** (3.11) helps the club learn from the people it passed over.

## 1. Summary

People in the club refer candidates. Each referrer ("judge") has a **weight** in (0, 1) for how much their referrals count. Three signals feed it, each arriving later than the last:

| Signal | Arrives | Role |
|---|---|---|
| **Admission** (council admits or denies the referred candidate) | weeks | early calibration, credited now and settled later |
| **Accuracy** (V2: did the referral's strength match outcomes) | 6 months | middle term, fades as movement arrives |
| **Movement** (did the candidate's evidence-backed substance rise beyond normal) | 12 months; 24 and 36 for pre-credential candidates | the long-run signal: spotting slope |

**Credit now, settle later.** The council's decision gives the judge early credit or debit. The candidate's movement result later replaces it:

- **Admitted and rose:** rewarded. The more the council relied on this judge, the larger the stake.
- **Admitted and flopped:** the early credit is taken back and replaced by a penalty with the same larger stake.
- **Denied and rose:** rewarded at the ordinary stake. The council missing someone is not a failure of the judge.
- **Denied and flopped:** an ordinary penalty.
- **Denied, but Jev shows substance ahead of credentials:** the early debit is **held in escrow** until the movement result arrives.

**Every referral's credit is scaled by three things fixed at referral time:** position (advocate, validator, confirmer), credential gap (pre-credential or consensus), and the judge's recognition answer.

**Movement credit uses a smooth curve.** Small results fade smoothly to nearly zero as noise; large results earn full credit. The curve is centred so that a typical candidate earns their judge exactly zero on average, which stops volume alone from earning credit.

**The anti-cohort watch** is a learning tool, not part of the weight maths. Each quarter, the organising committee checks in by hand on a bounded set of people the club passed over. Half the checks follow the judges' bets and half are random, so the club can measure whether the bets point at real misses.

Rules that keep it hard to game and stable over time:

- The candidate score is built **only from evidence judges didn't write**. Committee members may add sourced facts and, with a second member's approval, flag exaggerations. Never opinions.
- Every value has **fixed cutoffs and is stored once**. Corrections are explicit and logged.
- A judge never gets credit from a decision they took part in, or from an admission their own weight caused.
- **The judge's own answers never buy protection.** Escrow and extra settlements follow the credential gap Jev measures, not what the judge says.
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
logit w_u = logit μ0 + T · tanh(Σ_u / T)                 // μ0 = 0.3; soft cap T
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

- The answer is the judge's prediction, never evidence. It is frozen at referral time.
- It sets **only the stake size**, which is symmetric: a bigger bet means a bigger reward and a bigger loss.
- It never buys escrow or extra settlements. Answering "Not yet" on everyone therefore buys nothing but larger losses on the flops.
- Once credential catch-up is measured (3.8), "Not yet" and "Soon" will also be scored as predictions: did the candidate's credentials actually catch up?

**Per-referral weight:** `q_uv = share(k_uv) · c_uv · b_uv`.

A referral is **pre-credential** when `gap_uv ≥ g0`. This status depends only on Jev's measurement, never on the judge's answer.

### 3.3 Admission signal (early calibration)

```
a_uv  = +1 if the decision standing on v at t_uv + D is "admit", −1 if "deny", unscored otherwise
ρ_uv  = clip( (S_v − S_v^{−u}) / S_v, 0, 1 )   if admitted;   0 otherwise
ℓᴬ_uv = clip( κ_a · q_uv · a_uv · (1 − ρ_uv), −Lᴬ, Lᴬ )
```

- **Leave-one-judge-out, admissions only.** Each decision snapshot records, for every referrer, the Referral Signal **without** that referrer (`S_v^{−u}`) next to the full signal (`S_v`). For an admission, early credit counts only the part the judge's own weight didn't cause. A **denial always carries the full early debit**, unless it's escrowed.
- **Escrow for denied pre-credential candidates.** If the referral is pre-credential (3.2) and the candidate is denied, the early debit is **held, not applied**. The referral's first movement settlement replaces it as usual. Nothing else resolves it.
- **Fixed date:** the decision counted is the one standing at `t_uv + D`. A later `reopen` or reversal never changes it, except through a logged correction.
- **Recusal:** decisions get a new `decidedBy` field. A judge who took part in a decision gets no admission credit from it. Their referral keeps its own position for its stake, takes no position away from others, and settles at stake 1.
- **Referrals made after a decision** get no admission credit, because the judge could already see the outcome. They still take a position.
- **Starting snapshot required:** admission credit applies only once the referral has `s0` (3.5), i.e. once Jev has run an intake.
- **Admins see** each judge's weight and each referral's recognition answer. Members never see judge weights.

### 3.4 Settlement: movement replaces admission credit

When a referral gets a movement result `d_uvk` (3.6), its admission term (applied or escrowed) is removed, and its movement term is set:

```
stake_uv = 1 + (β − 1) · ρ_uv     if admitted;   1 otherwise
ℓᴹ_uv    = clip( q_uv · stake_uv · d_uvk, −Lᴹ, Lᴹ )     // Lᴹ generous, a backstop for the per-event bound
```

| Admission | Movement | Effect on the judge |
|---|---|---|
| admitted | rose beyond normal | early credit replaced by a reward, scaled up by reliance |
| admitted | fell beyond normal | early credit taken back and replaced by a penalty, scaled up by reliance |
| denied | rose beyond normal | early debit (or escrow) replaced by an ordinary reward |
| denied | fell beyond normal | early debit (or escrow) replaced by an ordinary penalty |
| either | within noise | early credit or debit removed, nothing (or nearly nothing) added |

- **Settlements for pre-credential referrals:** 12, 24 and 36 months. Each later result **replaces** the earlier movement term, so a breakout in year 2 or 3 still pays the judge. Other referrals settle at 12 months only.
- If a logged correction makes a referral pre-credential after its 12-month settlement, its 24- and 36-month settlements are scheduled then.

### 3.5 Evidence-only substance, fixed cutoffs

`evidenceScore(v, cutoffs)` gives Jev **substance** and **selection**, computed by a new `outputOnlyRollup`.

**Judge-free input:**

- Input is provenance-tagged raw Jev judgments, never finished `claimValue` numbers. Claim values are recomputed with referrer notes switched off.
- Every claim gets an `author` field (`candidate | referrer | committee | system`), separate from `source: SourceKind`. Accepted:
  - `candidate` and `system` claims;
  - `committee` claims that are **sourced facts**: they must carry a verifiable source (URL or document) and are judged by Jev like any evidence.

  Rejected: `referrer` claims, and any committee assessment or opinion. A runtime validator enforces this.
- **Committee flags** (3.12) can lower a claim's backing once approved. They never add value.
- No `trend` parameter. It never reads comparisons, Referral Signal, admission decisions, recognition answers, or anything downstream of judge weights.
- Each result records `hashInputs` of its input claims **sorted by claim id**, plus its config.
- V2's outcome labels never include `Outcome` rows derived from note-raised claim values.

**Snapshots.** Timing guard `G` (e.g. 30 days), arrival slack `S` (e.g. 30 days):

| Snapshot | Evidence dated | Computed at | For |
|---|---|---|---|
| `s0_uv` | ≤ `t_uv + G` | `t_uv + G + S` | every referral |
| `s12_uv` | ≤ `t_uv + 12 months` | `t_uv + 12 months + S` | every referral |
| `s24_uv`, `s36_uv` | ≤ `t_uv + 24` / `36 months` | `t_uv + 24` / `36 months + S` | pre-credential referrals |

- **Thin starting scores.** If Jev has run an intake but found little or no output evidence, the snapshot is the substance of whatever exists, down to a floor `s_floor`, and is marked **thin**. The floor applies to every snapshot. A thin snapshot is never treated as missing. The normal-movement fit (3.6) includes thin starts, so the typical rise from a thin start is subtracted, and referring empty profiles earns nothing by itself. A referral made before the candidate's intake has no `s0` until intake runs.
- **Late pre-referral evidence corrects `s0`.** Evidence dated ≤ `t_uv + G` that arrives after `s0` was computed triggers a **logged correction** of `s0`, and of `c_uv`, which depends on it. The correction reads committee flags as of `s0`'s original compute time. The evidence also counts in later snapshots. Withholding evidence therefore can't manufacture movement.
- **Standard check.** At each snapshot's compute time, every candidate, referred or not, gets the same automated public-evidence refresh (the Grok company research flow, SEA-75). Fits and settlements both use only evidence from the candidate's own submissions and this standard check, so extra effort spent on some candidates never changes their judges' rewards (3.11).
- **Timing guard:** evidence dated up to `G` after the referral counts toward the starting score.
- **Output dates:** each output is dated by when it became observable. Undated output from an in-progress role is dated by the role's `startedAt` (open decision 3).
- **Unreferred candidates** use their first Jev intake date in place of `t_uv`, with the same rules. They are needed for the fits in 3.2 and 3.6.

### 3.6 Movement against what's normal: smooth curve, neutral centre

For checkpoint `k ∈ {12, 24, 36}`:

```
m_vk   = substance(s_k) − substance(s0)       // raw movement
e_k(s) = a_k + b_k·s                           // normal movement for starting substance s
z_uvk  = (m_vk − e_k(s0_uv)) / σ_k             // movement beyond normal, in spread units
d_uvk  = g(z_uvk − c_k)                        // credit curve g, neutral centre c_k
```

**Neutral centre.** `c_k` is chosen so that the average of `g(z − c_k)` over the fit set is exactly 0. Typical candidates then earn their judges zero in total, and only better-than-typical movement earns anything. Centring on the mean or the median does not do this, because movement is skewed upward. The r8 simulation showed median centring added about +0.3 spreads of free credit to every referral, which let a sprayer reach the top.

**Credit curve `g`.** Three shapes are compared in the simulation (§5), which picks one:

| Shape | `g(x)` | Small results | Large results |
|---|---|---|---|
| **G1: hard band, compressed** (r8) | `sign(x) · ln(1 + max(|x| − h, 0))` | exactly 0 inside `±h`, then a kink | grows slowly |
| **G2: smooth, straight** (recommended) | `x · x² / (x² + h²)` | fades smoothly toward 0 (≈ `x³/h²`) | ≈ `x`: proportional |
| **G3: smooth, steep** | `sign(x) · (x² / (x² + h²)) · |x|^p`, `p > 1` | fades smoothly toward 0 | grows faster than proportional |

- A smooth curve has no edge for small parameter changes to push results across, which should widen the narrow passing region the r8 simulation found.
- Straight growth already gives a breakout proportionally more credit, because real outcomes are heavy-tailed.
- Steep growth rewards breakouts most, but risks one lucky hit deciding a judge's weight. The simulation's "lucky hit" check (§5, S3.d) tests this.

**Frozen versions.** `e_k`, `σ_k`, `c_k` and `f` are fitted on candidates who have already settled, released as numbered versions on a quarterly cadence, and **exclude the settling candidate entirely**, including its intake pair. Each stored result records its version. A new version applies only to results stored after it.

### 3.7 Accuracy fades as movement arrives

```
π_u = λ_f / (λ_f + n_settled,u)       // every settled referral counts, including within-noise results
```

Accuracy is level-based, so it rewards picking already-strong candidates. Fading it on every settled referral means long-run weight comes from spotting slope. The r8 simulation found `λ_f = 2` works and `λ_f = 8` breaks the worst-case bounds.

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
  - **Credential catch-up**: for pre-credential candidates, also measure selection rising toward substance; make normal movement depend on the gap; and score the recognition answers.

### 3.9 Accepted gaps

- **Collusion.** Two judges can plan to go 1st and 2nd on a candidate. This is accepted: the symmetric stake makes it costly when the candidate doesn't deliver, and committee flags (3.12) correct exaggerated evidence. The r8 simulation with a neutral centre passes this case.
- **Culture as the honesty incentive.** Judges aren't shown their stakes. Their personal reputation is on the line, and the symmetric stake makes the maths agree with that.
- **What evidence can't see.** Traits like resilience or unconventional range show up only in what a judge writes from firsthand knowledge, which never feeds the score. The judge's insight is rewarded later, through movement. Escrow and the 36-month settlement stop them being punished in the meantime.

### 3.10 What is dropped from Phase E

| Phase E piece | What replaces it |
|---|---|
| Separate scout number `Ĝ_u` | Movement term inside the single weight (3.4, 3.6) |
| `forecastKind: "will_compound"` tag | The recognition question, which sets stake size only (3.2) |
| Prior-recognition discount `(1 − π_v)` | Position schedule and credential gap (3.2) |
| Fixed `t0`/`t1` slope window, `minGapDays` | Stored snapshots with fixed cutoffs (3.5) |
| Upside-only `max(ΔR*, 0)` | Symmetric credit curve with stakes (3.4, 3.6) |
| Surprise term in comparison selection, trajectory reporting | Not replaced. They don't move a judge's weight |

### 3.11 Anti-cohort watch (learning tool)

A bounded, quarterly follow-up on people the club passed over. **It never changes a judge's weight.** Its value is what the club learns, measured by whether the judges' bets point at real misses better than chance.

**Who is eligible:** denied or stalled candidates (no decision, or stuck at "needs data") who were referred. Admitted members aren't eligible.

**Each quarter's budget `B`** (e.g. 20 checks) is split in two halves:

- **Prioritised half:** ranked by **bet size**, `Σ over the candidate's referrals of b_uv · c_uv`. Judge weight is deliberately left out, so the watch doesn't favour top judges' misses.
- **Random half:** drawn uniformly from all eligible candidates. This is the built-in baseline.
- **Per-judge cap:** no more than `C` checks a quarter on candidates referred by the same judge.

**Leaving the watch:** after 36 months, or once a check finds the person rose. There is no exit for flat checks: late bloomers look flat until they rise, and the r8 simulation showed a flat-check exit dropped them before they did.

**Committee checks:**

- The budget is split across organising-committee members on a rotation.
- **Conflicts:** no one checks a candidate they referred, voted on, or have a declared relationship with, or one referred by someone they have a declared relationship with.
- **Predict, then look.** Before looking anything up, the checker records a prediction (rose, flat or fell), then compares it with what they find. This builds each committee member's judgement on exactly the people the club passed over.
- **Sourced facts only.** Checkers add what they find as `committee`-authored sourced facts (3.5), and may propose flags (3.12). No opinions.
- **"Rose"** means substance above normal movement for the time elapsed since intake, by more than a stated margin.
- Checks need no cooperation from the candidate, so people who don't respond are still covered.

**Outputs** (engine analysis functions in `src/analysis/antiCohort.ts`, exploratory like `underRecognition.ts`; the club app renders them and runs the quarterly job):

| Output | What it shows |
|---|---|
| **Lift over random** | Real misses found per check in the prioritised half ÷ the same in the random half. Lift well above 1 means the judges' bets point at real misses. Lift near 1 means prioritisation adds nothing, and the watch should be simplified to random checks or dropped. |
| **Checks per miss found** | Whether the committee's time is well spent. |
| **Coverage by judge weight** | Whether low-weight judges' bets get checked as often as high-weight judges'. |
| **Regret report** | Each denied-then-rose case, with its decision snapshot (what the council saw) and the signals that pointed the right way (judge bets, gap, position). Also the denial-regret rate by credential level, which measures council credential bias. |
| **Reopen suggestions** | For admins. Nothing reopens automatically. |
| **Committee calibration** | Each checker's predictions against findings. Never feeds their judge weight. |

### 3.12 Committee correction of exaggerated claims

A committee member, on the watch or in normal review, can **propose a flag** on a claim as unsupported or exaggerated, for example a launch that didn't happen or a role smaller than described.

- **Two-person approval.** A flag takes effect only when a second committee member independently confirms it. Both must be free of conflicts (3.11).
- **Structured evidence.** A flag records the contradicting source and what it contradicts.
- **Effect:** an approved flag lowers only that claim's backing in Jev. It never changes a person's score directly and never adds value.
- **Reversal:** another committee pair can reverse a flag with a source. Reversal is a logged correction: it recomputes every affected snapshot and re-settles every affected referral.

This is the correction mechanism coached evidence needs.

---

## 4. Delivery order

Each step is its own PR and can be verified on its own:

0. **Simulation harness** (PR #116, at r8). Update it to r9: the three credit curves, the new checks (§5), and a wider sweep around the passing region.
1. **Weight scale.** `μ0`, `γ`, the soft cap, the log-odds form with only the accuracy term, the V2 compatibility branch, and `judgeWeighting` using `ω_u`. Register `judge_reliability@4.0.0` with a drift report.
2. **Admission, position and recognition.** `decidedBy`, per-referrer leave-one-judge-out signals on decision snapshots, the recognition question, position ranking, `q_uv` without the gap, `ℓᴬ`. This delivers goal 1. Its own version and drift report.
3. **Evidence-only substance.** `author` field (including committee sourced facts) and runtime validator, two-person committee flags with reversal, `outputOnlyRollup`, output dating, sorted hashing, the truth-label guard. No weight changes.
4. **Stored snapshots.** `s0` (including thin starts), `s12`, and `s24`/`s36` for pre-credential referrals, the standard check for all candidates, and the logged correction operation. No weight changes.
5. **Movement, settlement, gap, escrow and fading.** Versioned fits, the neutral centre and the chosen credit curve, stakes and settlement, the credential gap, escrow, the accuracy fade, the gate and ramp, the judge label. Its own version and drift report.
6. **Anti-cohort watch.** Eligibility, the split budget, the per-judge cap, committee rotation and conflicts, predict-then-look, and the outputs in 3.11.
7. **Credential catch-up** and scoring of recognition answers. Its own version and drift report.

## 5. Simulation scenarios

Synthetic clubs with known judge skill, run through the whole pipeline. Each scenario states its data-generating process before it runs. Results are from PR #116 at its chosen parameters, 5 seeds. "r8 + neutral" is r8 rerun with the neutral centre.

| # | Scenario | Pass if | r7 | r8 | r8 + neutral |
|---|---|---|---|---|---|
| S1 | **Best case:** honest, skilled judges, fair council | Skill order recovered: Spearman ≥ 0.7 at 36 months, ≥ 0.5 at 12 | pass (0.75 / 0.58) | fail (0.55 / 0.40) | pass (0.77 / 0.52) |
| S2 | **Mostly good:** plus a consensus-picker | Consensus-picker ends below early spotters of equal accuracy | pass | pass | pass |
| S3 | **Mixed:** early spotter, consensus-picker, sprayer, noisy judge, slow evidence. **New in r9: S3.d, a one-hit judge** with a single breakout and otherwise noise | Skill order recovered; the sprayer ends below every honest judge; **the one-hit judge ends below a consistent spotter** | pass | fail | pass (S3.d new) |
| S4 | **Adversarial:** colluding pair, coached evidence with committee flags, withheld evidence, a credential-biased council. **New in r9: S4.d everyone answers "Not yet"; S4.e a malicious committee member** | Colluders don't outrank honest spotters; withheld evidence never creates movement; denied-but-rose judges gain; **universal "Not yet" gains nothing over honest answers; a single malicious flagger has no effect, and an approved-then-reversed flag leaves no trace** | 2 fails | 1 fail | pass (S4.d, S4.e new) |
| S5 | **Worst case:** most judges game, council follows visible weight, little evidence, tiny cohort | Bounds hold; no runaway; movement off below the gate | pass | pass | pass |
| S6 | **Out of distribution:** thin, unconventional evidence; a credential-biased council that denies them; heavy-tailed rises over 18–36 months | Backers end above consensus-pickers by month 36; escrow keeps them from dropping below `μ0` in the meantime; **breakouts in months 25–36 improve their judges' weights on their own** | — | pass (25–36 not tested) | pass (25–36 new) |

**Robustness (new in r9):** a design passes only if a stated share of the parameter sets around the chosen one also pass, not just the single best set. r8 with the neutral centre passed at only 4 of 288 sets, with a 0.018 margin.

**Curve comparison (new in r9):** G1, G2 and G3 (3.6) are each run through S1–S6. The spec adopts the shape with the widest robust passing region that also passes S3.d.

**Watch metrics (reported, not pass/fail for weights):** lift over random, checks per miss found, and coverage by judge weight, in S6 and S3. The r8 simulation found the watch never changes weights, as intended.

## 6. Invariants (tests)

- **V2 compatibility:** `mode: "v2"` returns V2's outputs exactly. Runs still on V2 keep their golden run ids.
- **Bounds:** `w_u` and `ω_u` are always strictly inside (0, 1), including in floating point, and `judgeWeighting` never throws.
- **Per-event bound:** every kind of event (adding, settling, correcting or re-settling a referral, a flag or its reversal, an accuracy update, a ramp step) changes any judge's `logit w` by at most a stated bound for that kind.
- **Recusal:** a decision the judge took part in never gives that judge admission credit.
- **No self-caused credit:** an admission that rested entirely on judge `u` (`ρ = 1`) gives `u` no early credit.
- **Denials:** a denial's early debit doesn't depend on `ρ`.
- **Escrow:** a denied pre-credential referral's debit is not applied before its first settlement. A recognition answer never changes whether a referral is escrowed.
- **No permanent credit:** a referral without `s0` never carries admission credit.
- **Settlement:** after a referral settles, its admission term is gone and only its movement term remains. A later settlement replaces the earlier movement term.
- **Position:** with everything else equal, an earlier position earns at least as much as a later one, for rewards and penalties alike.
- **Symmetric bets:** for any recognition answer, the reward for a rise and the penalty for an equal fall have the same size.
- **Neutral centre:** on each fit version's own data, the average credit `g(z − c_k)` is 0. Out of sample, a judge's average credit per referral doesn't grow with how many referrals they make.
- **Monotone curve:** a larger rise always earns at least as much as a smaller one, up to the per-referral backstop.
- **No judge input:** referrer notes, referrer-authored claims, a `trend` value, an admission decision or a recognition answer never change `evidenceScore`.
- **Committee input:** a committee claim without a source is rejected; a flag without a second approval has no effect; a flag never raises `evidenceScore`; reversing a flag restores every affected snapshot and settlement exactly.
- **Truth labels:** V2 outcome labels never include rows derived from note-raised claim values.
- **No manufactured movement:** withholding pre-referral evidence and submitting it later gives the same movement result as submitting it on time.
- **Watch never changes weights:** every judge's weight is identical with the watch on or off.
- **Arrival order:** the same evidence in different batches or orders gives the same snapshots, after corrections, and the same hashes.
- **Refit:** a new fit version never changes an already-stored result, and never includes the settling candidate.
- **Fade:** `π_u` falls monotonically with every settled referral.
- **Gate:** below `M`, or with too little spread in starting scores, the movement term is 0.
- **Watch budget:** a quarter never schedules more than `B` checks, half of them random, and never more than `C` per judge; no checker is assigned a candidate they conflict with.
- **Committee separation:** a committee member's checking record never changes their judge weight.
- **Simulations:** S1–S6 pass, robustly (§5).

## 7. Open decisions

1. **Credit curve:** G1, G2 or G3, chosen by the simulation (3.6, §5). G2 is the expectation.
2. **Parameter values:** `μ0 = 0.3`, `γ = 2` and `λ_f = 2` are chosen. The rest come from the simulations: `T`, `α`, `φ`, `β_g`, `c_min`, `c_max`, `g0`, the `b` values, `β`, `D`, `G`, `S`, `h`, `p` (for G3), `s_floor`, `κ_a`, `κ`, `Lᴬ`, `Lᴹ`, `M`, `σ_min`, `N`, `λ`, `B`, `C`.
3. **Undated in-progress output:** dating it by the role's `startedAt` can miss real growth in a long-running role. To be decided later.
4. **Ties at the top:** the soft cap bounds the total but not the volume effect. If ties at the ceiling persist with the neutral centre, scale each judge's movement sum by their referral volume. The simulation checks this.
5. **Watch size:** `B` per quarter and `C` per judge, set from committee capacity and the lift results.
6. **Display bands** (C … A) for admins: separate from this spec.
7. **Referral-volume signal** (many referrals plus passing evaluations means a name is spreading): a candidate signal, tracked separately.

## 8. Review history

- **Round 1 (Codex, r1):** free bet on candidates without evidence; import-only circularity guard; unfair steps at ladder ends; hysteresis needed history; impossible run-id invariant.
- **Round 2 (Codex, r2):** padding helped negative judges; note-raised values reached the rollup; "latest score" moved old results; grace-period lookahead; band-only expectation; mutable role mix.
- **Self-review (r3):** padding through non-moving referrals; referrer-added claims; arrival order; refits moved old results.
- **Round 3 (Kimi K3 max, Grok 4.7 xhigh, r4):** weight above 1; shrinkage toward 1; version clash; V2 description; judge inputs; hash order; resume-date exploit; hidden truth-label path; coached evidence; undefined per-role; mixed horizons; winner's curse; minimum cohort; `h` units; timing; value vs substance; name clash.
- **Round 4 (Codex, r5):** late evidence manufactured movement; accuracy rewarded credentialism; no early calibration; abrupt club gate; goal 2 not delivered; V2 equivalence false at `p̂ = 1`.
- **Round 5 (Codex, r6):** admission fed itself; permanent unsettled credit; ramp before the fit; fade missed normal movers; settlement repriced history; no consensus discount.
- **Round 6 (simulation on r7, the "Out of Distribution" essay, Sean's decisions; r8):** dead-band drift; withheld evidence; coaching; no volume cap; `ρ` direction; per-event bound; spec gaps; escrow; compression; late bloomers; thin evidence; anti-cohort watch; S6.
- **Round 7 (Codex on r8, simulation on r8, Sean's decisions), handled in r9:**
  - Median centring drifts upward; both Codex and the simulation found it, and the simulation measured it → neutral centre (3.6).
  - Hard band edges make the design fragile (4 of 288 sets pass) → smooth credit curve, with three shapes compared, and a robustness criterion (3.6, §5).
  - Year-3 breakouts couldn't pay → 36-month settlement for pre-credential referrals (3.4).
  - "Not yet" bought escrow and a second settlement → escrow and extra settlements follow the measured gap only; the answer sets stake size; universal "Not yet" scenario (3.2, 3.3, S4.d).
  - The watch protected top judges → priority by bet size, not weight; half random; per-judge cap; coverage by judge weight (3.11).
  - One committee member could change evidence → two-person approval, structured evidence, broader conflicts, reversal recomputes and re-settles (3.12, S4.e).
  - The watch never changes weights, so "release" did nothing → the watch is a learning tool; release removed (3.3, 3.11).
  - The flat-check exit dropped late bloomers → removed (3.11).
  - "Find half the misses" was arbitrary and mostly measured the budget → replaced by lift over random (3.11, §5).
  - A one-hit judge might win under a steep curve → S3.d.
  - Simulation spec-gap readings adopted: corrections read flags as of the original compute time; fits exclude the settling candidate entirely; the standard check covers all candidates; the floor applies to every snapshot; late corrections schedule later settlements; "rose" is relative to the elapsed time.

## 9. Questions for reviewers (round 8)

1. **Out of distribution:** read against the "Out of Distribution" essay, does r9 reward the judges who spot people who look like bad bets on paper? Where does it still favour credentials?
2. **Neutral centre:** is choosing the centre so that the fit set's average credit is zero sound, given that the fit set grows and shifts over time?
3. **Credit curve:** which of G1, G2 and G3 would you choose, and why?
4. **Escrow from the gap only:** does tying escrow and extra settlements to Jev's measured gap leave out real out-of-distribution people whose gap Jev can't see because their evidence is thin?
5. **Watch:** is lift over random, with a built-in random half, the right way to judge whether the watch is worth the committee's time?
6. **Committee flags:** are two-person approval, structured evidence and recompute-on-reversal enough?
7. **Anything still gameable or circular.**
