# Model spec changelog

Append-only. One entry per `ModelSpec` version (see `src/models/registry.ts`).

A weight, multiplier, threshold, or model-form change **must** ship as a new
spec version with an entry here — never as an edit to an existing version.
Each entry records what changed, why, the drift report summary, and the PR.

Run `bun run drift -- --kind <kind> --before <version> --after <version>` on
the seed dataset and paste the summary line into the entry.

---

## referral_signal@0.1.0 — initial

- **What:** `X_uv = 0.50·n(conviction) + 0.30·n(confidence) + 0.20·n(relationshipDepth)`;
  `m_e = { firsthand_work 1.00, firsthand_personal 0.90, artifact 0.85, reputation 0.60, other 0.70 }`;
  `S_v = mean(Top5 R_uv)`.
- **Why:** Values taken verbatim from the MVP prompt §9. Judge reliability `p_u`
  is fixed at 1.
- **Drift:** n/a (first version).
- **PR:** initial import.

## bradley_terry@1.0.0 — initial

- **What:** `L(θ) = −Σ logσ(θ_w − θ_l) + 0.1·Σ θ_i²`, zero-mean per component,
  `maxIterations 500`, `tolerance 1e-6`, `minComparisons 3`, `minOpponents 2`,
  `tieHandling "ignore"`, `anchorStrength 0`.
- **Why:** λ = 0.1 is a modest default that keeps single-comparison nodes near
  0 on the seed data. It is not tuned and not theoretically optimal.
- **Drift:** n/a (first version).
- **PR:** initial import.

## judge_reliability@2.0.0 — initial (V2 judge calibration)

- **What:** Each referral is scored as a prediction once `T − t_uv` has cleared
  `observationWindowDays = 180`, against a causal cohort of outcomes observed
  after the referral (kind ranks, `E[R|O]` buckets and residual percentiles
  share that cutoff). Outcomes are rank-normalised within `kind` (kinds with
  fewer than `minKindSize = 3` outcomes are ignored), corrected for opportunity
  by bucket mean (`opportunityBuckets [1, 2, 3]`, `minBucketSize 2`) with the
  opportunity count taken on the referral clock (`opportunityClock "referral"`),
  and the residual's cohort percentile is the truth. One prediction per
  (judge, candidate): the earliest referral; edited rows are skipped
  (`excludeEditedReferrals true`). `evaluatedAt` is
  `max(createdAt + window, firstEligibleAt)` so EWMA waits for the kind to
  reach `minKindSize`, not just the first later outcome. Per judge:
  `Ē ← (1−η)Ē + ηE` with `η = 0.3`,
  `p = exp(−τĒ)` with `τ = 4`, shrinkage `λ = 3` toward `μ_p = 1`, signed bias
  shrunk toward 0; `applyBiasCorrection false`.
- **Why:** Implements the white paper's "Longitudinal Observation", "Learning
  Who Is Good at Identifying Talent", "Shrinkage" and "Learning Judge Bias"
  sections. `μ_p = 1` keeps every judge at V0 weight until evidence says
  otherwise, so with no outcomes V2 reproduces V0 exactly (asserted by tests).
  The per-prediction causal cohort, T-side window, referral-clock opportunities
  and kind minimum close the leakage and small-cohort holes raised in review of
  PR #17. η, τ, λ are untuned defaults.
- **Referral Signal:** `referral_signal@0.1.0` is unchanged in value. It gains an
  optional judge-weight hook `p̂_u · clip(R_uv − b̂_u)` that is the identity when
  no weights are passed; runs that pass weights record copies of them and
  `judgeWeighted: true` in `ModelRun`. Zero-reliability judges are dropped from
  Top-K. `strongest` stays the raw max `R_uv`.
- **Drift:** n/a (first version; with the seed's synthetic outcomes,
  `bun run demo` shows the weighted vs unweighted Referral Signal side by side).
- **PR:** #17.

## judge_reliability@3.0.0 — registered, not current (Phase E1)

- **What:** Same numeric V2 fields plus optional V3 keys `scoutHook: false`,
  `scoutShrinkage: 3` (λ_g), `slopeMinGapDays: 90`. Domain types for
  `ResidualSlope` and `ScoutInformationGain` land alongside; no production
  math reads the new fields yet.
- **Why:** Versioned target for later Phase E slope snapshots and scout
  information gain. Registered so `getSpec("judge_reliability", "3.0.0")`
  works; `CURRENT_SPECS.judge_reliability` stays `2.0.0`.
- **Drift:** n/a until later (not current; no math change).
- **PR:** #28 (issue #20).
