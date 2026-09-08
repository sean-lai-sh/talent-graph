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

- **What:** Referrals are scored as predictions once `observationWindowDays = 180`
  have passed and the candidate has a later outcome. Outcomes are rank-normalised
  within `kind`, corrected for opportunity by bucket mean
  (`opportunityBuckets [1, 2, 3]`, `minBucketSize 2`), and the residual's rank
  percentile is the truth. Per judge: `Ē ← (1−η)Ē + ηE` with `η = 0.3`,
  `p = exp(−τĒ)` with `τ = 4`, shrinkage `λ = 3` toward `μ_p = 1`, signed bias
  shrunk toward 0; `applyBiasCorrection false`.
- **Why:** Implements the white paper's "Learning Who Is Good at Identifying
  Talent", "Shrinkage" and "Learning Judge Bias" sections. `μ_p = 1` keeps every
  judge at V0 weight until evidence says otherwise, so with no outcomes V2
  reproduces V0 exactly (asserted by tests). η, τ, λ are untuned defaults.
- **Referral Signal:** `referral_signal@0.1.0` is unchanged in value. It gains an
  optional judge-weight hook `p̂_u · clip(R_uv − b̂_u)` that is the identity when
  no weights are passed; runs that pass weights record them in `ModelRun`.
- **Drift:** n/a (first version; with the seed's synthetic outcomes,
  `bun run demo` shows the weighted vs unweighted Referral Signal side by side).
- **PR:** V2 judge calibration.
