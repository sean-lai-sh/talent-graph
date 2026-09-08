# V2: judge calibration from longitudinal outcomes (reliability p_u, shrinkage, bias b_u)

**Phase D · depends on: #2, #10, #15**

## Goal
Implement the white paper's correction mechanism for judges: at a time step T,
re-read every referral made before T as a prediction, score it against what the
referred person actually did, and turn each judge's track record into a
reliability weight that the Referral Signal can use. Grounded in outcomes, never
in V1 estimates (which are themselves built from judges' comparisons).

## Theory (docs/theory/main.tex)
Sections "Longitudinal Observation", "Learning Who Is Good at Identifying
Talent", "Shrinkage: Preventing Instant Oracles", "Learning Judge Bias".

```
R_v      realised outcome, rank-normalised within its kind         ∈ [0,1]
R*_v   = R_v − E[R_v | O_v]                                         opportunity-corrected
truth_v = rank percentile of R*_v / 100                             ∈ [0,1]
x_uv   = R_uv  (unweighted V0 strength of the referral)             the prediction
E_uv   = (x_uv − truth_v)²
Ē_u   ← (1−η)·Ē_u + η·E_uv          chronological by evaluation      η = 0.3
p_u    = exp(−τ·Ē_u)                                                 τ = 4
p̂_u    = n/(n+λ)·p_u + λ/(n+λ)·μ_p                                   λ = 3, μ_p = 1
b_u   ← (1−η)·b_u + η·(x_uv − truth_v),  b̂_u shrunk toward 0
```

Referral Signal hook: contribution of referral u → v becomes
`p̂_u · clip(R_uv − b̂_u, 0, 1)`. With no weights (or p̂ = 1, b̂ = 0) this is
exactly `R_uv`, so V0 is reproduced bit-for-bit.

## Implementation choices (engineering, not theory)
- **E[R_v | O_v]** is the mean normalised outcome of people in the same
  opportunity-count bucket (`opportunityBuckets [1,2,3]`), falling back to the
  global mean when a bucket has fewer than `minBucketSize` people. With no
  opportunity records this is a constant and residual ranks equal raw ranks.
- **Evaluable at T** iff `T − referral.createdAt ≥ observationWindowDays` (180)
  and the candidate has a measurable outcome observed after the referral.
- **μ_p = 1** so a judge with no evaluated predictions keeps V0 weight. The
  population mean reliability is reported for callers who prefer it as prior.
- **Bias correction is estimated always, applied only when
  `applyBiasCorrection` is true** (default false in 2.0.0).
- Comparisons are not scored in 2.0.0 (the paper specifies the referral case);
  V1 ignores judge weights as before.

## Files
- `src/models/spec.ts` — `JudgeReliabilitySpec`; `src/models/registry.ts` —
  `JUDGE_RELIABILITY_V2_0_0`, `CURRENT_SPECS.judge_reliability`.
- `src/judges/outcomes.ts` — `residualOutcomes(outcomes, opportunities, spec, now)`.
- `src/judges/reliability.ts` — `scoreReferralPredictions`,
  `estimateJudgeReliability`, `computeJudgeCalibration({ people, referrals,
  outcomes, opportunities?, now, spec?, referralSpec? })`, `judgeWeightOptions`,
  `toJudgeCalibration`, `toJudgeBias`.
- `src/scoring/referralSignal.ts` — `judgeReliability` / `judgeBias` options;
  `ContributingReferral.judge`, `ReferralSignalResult.judgeWeighted`.
- `src/modelRun.ts` — `runJudgeCalibration`; weighted `runReferralSignals`
  records the weights it used.
- `src/domain/validate.ts` — `validateOutcome`, `validateOpportunity`.
- `src/seed/outcomes.ts` — synthetic opportunities/outcomes; `SeedDataset`
  gains `opportunities` and `outcomes`.

## Tests — `tests/judges.test.ts` (+ spec, validate, modelRun, seed, invariants)
- No outcomes ⇒ every judge at μ_p and the weighted signal equals V0 exactly.
- Accurate judge → p̂ = 1; inaccurate → p̂ < 1; unevaluated → prior.
- Shrinkage: closed-form p̂ for 1 vs 5 wrong calls.
- Ē is an EWMA in evaluation order (0.7 vs 0.3 for the two orderings).
- Observation window and "outcome must follow referral" gates.
- Opportunity correction lowers the residual of a boosted person with the same raw outcome; small buckets fall back to the global mean.
- Bias sign, shrinkage, default off, lowers an overrating judge when on.
- Top-K reorders under weights; invalid spec / weights rejected.
- Invariants: `src/judges` never imports `src/inference` (no circular truth) and never reads the clock; `src/scoring` never imports `src/judges`.

## Do not
- Use V1 capability percentiles as "truth" for judge scoring.
- Weight judges by agreement with other judges.
- Let `p̂_u` feed back into `x_uv` (the prediction is always the unweighted R_uv).
