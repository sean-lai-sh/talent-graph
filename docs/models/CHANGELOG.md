# Model spec changelog

Append-only. One entry per `ModelSpec` version (see `src/models/registry.ts`).

A weight, multiplier, threshold, or model-form change **must** ship as a new
spec version with an entry here — never as an edit to an existing version.
Each entry records what changed, why, the drift report summary, and the PR.

Run `bun run drift -- --kind <kind> --before <version> --after <version>` on
the seed dataset and paste the summary line into the entry. Every entry needs
a `**Drift:**` line — `tests/invariants.test.ts` iterates `SPEC_HISTORY` and
requires one per registered version.

The script exits 1 when the worst verdict is above `--max-verdict` (default
`review`, so only `breaking` fails), 2 on a usage error. CI runs it through
`bun run drift:gate` for every `CURRENT_SPECS` version a pull request moves, so
a `breaking` change has to ship as a deliberate one.

`drift:gate` resolves the registry on both sides of the pull request rather
than diffing file paths, and refuses any registered version whose *content*
changed under an unchanged version number — "never edit an existing version" is
enforced, not just written down. That includes a change to
`src/domain/constants.ts`: `REFERRAL_WEIGHTS` and `EVIDENCE_MULTIPLIER` are
spread into `referral_signal@0.1.0`, so editing them rewrites a shipped version
even though `registry.ts` is byte-identical. Ship a new version instead.

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

## career_evidence@1.0.0 — initial (career-evidence rubric)

- **What:** The rubric levels, question text, event taxonomy and gate
  thresholds the longitudinal evidence pipeline judges with, moved out of
  `apps/club/lib/longitudinal/jev.ts` into `CAREER_EVIDENCE_V1_0_0` without a
  character changing: five dimensions (`difficulty`, `ownership`,
  `external_impact`, `originality`, `peer_validation`) on one shared five-level
  scale (`MAX_LEVEL = 4`), the identity decision (`different` / `review` /
  `same`) with its three field questions, the seven `CareerEventKind` criteria
  plus the mandatory `no_supported_event` escape hatch, `model "jev"`, and
  thresholds `identityConfidence 0.75`, `identityContradiction 0.25`,
  `eventConfidence 0.65`, `dimensionConfidence 0.5`. The constant lives in the
  leaf module `src/models/careerEvidence.ts`, which `registry.ts` imports to
  append the version — the longitudinal pipeline and the Club adapter read the
  leaf, never the registry, so the evidence signal does not reach the Referral
  Signal or capability code even transitively. The Club adapter takes the
  spec and builds its SDK questions from it; `DEFAULT_EVIDENCE_POLICY` is the
  policy the spec implies. Events keep the stamp they already carry
  (`questionVersion "career-evidence@1.0.0"`, `model "jev"`) — the stamp names
  the question set, not the spec object.
- **Why:** The wording *is* the model here. A reworded level description
  changes what an answer means, so it has to be versioned like a weight:
  `careerEvidenceRubricHash` fingerprints the levels, questions, criteria and
  requested model, and `careerEvidenceSpecId`
  (`career_evidence@1.0.0:6290bc28`) carries it, so a silent edit changes the
  id even though the version did not move.
  `tests/careerEvidenceSpec.test.ts` pins that hash.
- **Drift:** n/a (first version; the spec produces no number of its own — it
  carries the rubric, question text and thresholds the career-evidence
  pipeline stamps on events)
- **PR:** #54 T5.

## Run id format

Run ids are not spec versions: this section records changes to the format of
`ModelRun.id`, which is append-only in the same way.

### RUN_ID_FORMAT 2 — explicit lineage (#55 T3)

- **Format:** `${kind}/${model}@${specVersion}:${inputHash[0..12]}:${paramHash[0..8]}`,
  where `paramHash = hashInputs({ parameters, upstreamRuns })`. Format 1 was
  `${modelType}@${modelVersion}:${inputHash[0..12]}:${paramHash[0..8]}` over
  `parameters` alone.
- **What changed:** `modelType` became `kind` (the `ModelSpec` kind) plus the
  definition's `model` name; the composed version tag `0.1.0+judge_reliability`
  is gone; a judge-weighted Referral Signal run and an anchored Bradley–Terry
  refit both record `upstreamRuns: [{ role, runId, digest }]` instead of a tag
  or of `previousRunId` / `previousThetaHash` in `parameters`.
- **Why:** `0.1.0+judge_reliability` was not resolvable — `getSpec` threw on it
  — so a weighted run could not be reproduced from its own record, and the tag
  named a *kind* rather than a run, so two calibrations at different `T` gave
  byte-identical ids. `getSpec(run.kind, run.specVersion)` now succeeds for
  every run the pipeline can produce.
- **Numbers:** unchanged. No spec version moved; the golden fixture's
  `outputsHash` per run is identical under both formats, and
  `tests/fixtures/run-ids-format2-mapping.json` maps every seed run's old id to
  its new one beside that hash.
- **Persistence:** no run id was stored anywhere (no run-id column in
  `apps/club/convex/schema.ts`; `ClubSnapshot` has no `modelRunIds`), so
  nothing written was invalidated.
- **Orphan lineage ids (review round 2):** a lineage id is only accepted
  together with the run output it names. `judgeRunId` without
  `judgeReliability` or `judgeBias`, and `previousRunId` without `previous`,
  used to be accepted and left out of `upstreamRuns` — two calls claiming
  different upstream runs produced one id. Both now throw in `resolveOptions`,
  before anything is hashed. Well-formed combinations are unchanged: an id with
  its output is recorded as `{ role, runId, digest }`, and an output passed
  without an id is still recorded, with `runId: null`, so an unnamed prior is
  reported as unknown rather than invented. No id moved; both fixtures pass
  without regeneration.

## Pipeline

Not a spec version either: how the runs of a pass are ordered and recorded.

### `advance()` — one pass, one run per kind (#55 T4)

- **What:** `src/pipeline/advance.ts` is the only place the calibration →
  weights → signal order is written. One pass produces a `judge_reliability`
  run, a `bradley_terry` run and a `referral_signal` run, plus the
  judge-weighted `referral_signal` run the calibration's weights feed. It
  never combines two kinds into one number. `now` is a parameter — the
  evaluation time step T — and `src/pipeline/` never reads the clock
  (`tests/invariants.test.ts`).
- **Why:** `scripts/demo.ts` and `scripts/drift.ts` each wrote that order out
  by hand, so the order could drift apart between callers and every new
  caller had to rediscover which spec feeds which step.
- **Numbers:** unchanged. `bun run demo` is byte-identical to
  `tests/fixtures/demo-golden.txt`, captured from the pre-refactor script, and
  `tests/advance.test.ts` asserts a pass reproduces the run ids in
  `tests/fixtures/run-ids-golden.json` for every kind. Neither run-id fixture
  was regenerated.
- **Drift:** `bun run drift` takes any kind the pipeline runs (derived, not
  enumerated) — including `judge_reliability`, whose per-judge `reliability`
  and `bias` maps are compared as points out of 100 under the existing
  thresholds and verdict rules — and `--v0-vs-v2` compares the unweighted
  Referral Signal against the judge-weighted one from a single pass.
- **PR:** #55 T4.
