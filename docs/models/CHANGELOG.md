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

- **What:** `src/pipeline/advance.ts` is the only place a pass's evaluation
  order is written: V0 referral signal → capability → calibration →
  judge-weighted referral signal. One pass produces a `referral_signal` run,
  a `bradley_terry` run and a `judge_reliability` run, plus the
  judge-weighted `referral_signal` run the calibration's weights feed — four
  runs, of which the first and the last share a kind. It never combines two
  kinds into one number. `now` is a parameter — the evaluation time step T —
  and `src/pipeline/` never reads the clock (`tests/invariants.test.ts`).
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

### The kind unions, collapsed onto `PipelineKind` (#55 T7)

- **What:** `LoadedSpecs` (src/config.ts) is a mapped type,
  `{ config: TalentGraphConfig } & { [K in PipelineKind]: SpecOfKind<K> }`,
  instead of three named fields; `DriftReport["kind"]` is `PipelineKind`
  instead of its own string union; `DriftKind` is `PipelineKind` rather than
  an intersection guarding the two lists against each other. `RunOutputs` in
  `src/pipeline/advance.ts` is now the single hand-written list of the kinds
  a pass runs, and everything else is derived from it or checked against it.
- **Why:** four lists of kinds were maintained by hand and could disagree —
  and one already had. `PipelineKind` rather than `ModelSpecKind` because the
  two are not the same question: a registered spec kind the pipeline never
  evaluates (versioned rubric data, say) produces no number, so it has
  nothing for a `TG_*` override to move and nothing to drift-compare, and
  mapping the env bridge over every registered kind would have forced it in.
- **Numbers:** unchanged; no run id moved. The mapped type resolves to the
  same concrete field types, so every `specs.referral_signal` /
  `specs.bradley_terry` / `specs.judge_reliability` / `specs.config` read —
  the Club's included — compiles and means exactly what it did.
- **Drift:** none to report: no spec version moved. The drift CLI's
  invocations print byte-identical output.
- **Fixtures:** `tests/specKinds.test.ts` pins the collapse with
  `@ts-expect-error` fixtures, and records the two simulations behind the
  acceptance criterion: registering a kind the pipeline does not run is one
  compile error (`CURRENT_SPECS`), and registering one it does run is three
  (`CURRENT_SPECS`, the `loadSpecs()` return, `PIPELINE_KINDS`) plus the
  kind's own `defineModel` file, which is new code rather than a break.
- **Gate:** `scripts/drift-gate.ts` partitions the moved versions with
  `driftableMoves`. The append-only and in-place-edit checks still apply to
  every registered kind; only a kind a pass runs reaches `scripts/drift.ts`.
  A bump of a rubric-only kind prints
  `skipped <kind> <before> → <after>: not a pipeline kind, nothing to measure`
  and passes, where it used to be handed to a CLI that exits 2 and be read as
  a failed drift report.
- **PR:** #55 T7.

### The kind vocabulary is a leaf module; the `modelRun.ts` shim is gone (#55 T8)

- **What:** `RunOutputs`, `PipelineKind`, `PIPELINE_KINDS` and
  `isPipelineKind` moved from `src/pipeline/advance.ts` to a new
  `src/pipeline/kinds.ts`, which imports types only and computes nothing.
  `advance.ts` re-exports all four, so every existing import of them keeps
  working; `scripts/drift-gate.ts`, `src/config.ts` and `src/analysis/drift.ts`
  now import the leaf. `src/modelRun.ts` — the compatibility shim left behind
  by #55 T3 — is deleted; `src/index.ts` exports the real modules
  (`models/definitions/`, `models/run.ts`, `provenance/hash.ts`) in its place.
- **Public surface:** two deprecated names go with the shim — its
  `createModelRun` alias for `createRun`, and `ModelType`, the run id format 1
  naming scheme `src/models/run.ts` kept only for the shim's importers and
  which nothing under `src/`, `scripts/`, `tests/` or `apps/club/` referenced.
  One name is added: exporting `src/models/run.ts` with `export *` rather than
  through the shim's named list also exposes the type `RunRecordInput`. No
  value export changed except `createModelRun`.
- **Why:** asking "is this a kind a pass runs?" should not import a pass. The
  CI gate script walks a registry diff and the env bridge keys itself on the
  pipeline's kinds; neither evaluates anything, and both were pulling in the
  whole scoring/inference graph through the orchestrator. `RunOutputs` stays
  the single hand-written list of the pipeline's kinds — splitting it from
  `PipelineKind` would have recreated one of the parallel unions #55 T7
  collapsed — so the leaf names its three output types with `import type`,
  which costs nothing at runtime.
- **Numbers:** unchanged, and no run id moved. Nothing here touches a spec,
  a parameter or an evaluation order: `tests/fixtures/run-ids-golden.json`
  and `tests/fixtures/run-ids-format2-mapping.json` pass without
  regeneration, and `bun run demo` is byte-identical to
  `tests/fixtures/demo-golden.txt`.
- **Invariant:** `tests/invariants.test.ts` now asserts that
  `scripts/drift-gate.ts` and `src/config.ts` do not import
  `src/pipeline/advance.ts`, and the "explicit meeting points" allow-list
  carries `src/pipeline/kinds.ts` (types only) instead of `src/modelRun.ts`.
- **PR:** #55 T8.

## Longitudinal

### Career-evidence vocabulary; the evidence modules split (#54 T8)

- **What:** the judgment types stop carrying a third word for the concept they
  already name. `ProgressDimension` is `CareerEvidenceDimension`,
  `ProgressVector` is `CareerEvidenceVector`, and `progressVector()` is
  `careerEvidenceVector()`; no alias is left behind, and
  `tests/careerEvidence.vocabulary.test.ts` greps `src/longitudinal/**` for the
  word "progress", case-insensitively, with nothing excluded.
- **Why:** two words, cleanly divided. `longitudinal` is the time concept —
  monitoring plans, checkpoints, cutoffs, residual slope. `career-evidence` is
  the judgment concept — claims, events, rubric, spec, dimensions. "Progress"
  belonged to neither and read as a third one.
- **Stamp prefix:** the `questionVersion` an event carries changes from
  `career-evidence@1.0.0` to `career_evidence@1.0.0`. The prefix is now the
  spec id's, so the two agree: an event stamped `career_evidence@1.0.0` and a
  record filed under `career_evidence@1.0.0:<rubricHash>` name the same version
  of the same thing, and a reader no longer has to know that one of them spells
  it with a hyphen. Only the prefix moved — not the version, not the rubric
  hash, and nothing that is hashed: no claim id, event id, snapshot hash,
  request fingerprint or run id reads the stamp, so
  `tests/fixtures/longitudinal-golden.json` changes on exactly the seven lines
  that hold the string and no other fixture changes at all. The frozen
  `career_evidence@1.0.0` entry below still quotes the old stamp; that is
  history, and an append-only changelog does not rewrite it.
- **Layout:** `src/longitudinal/pipeline.ts` (921 lines) and `records.ts` (494)
  split along the seams they already had. New modules, all behaviour-preserving
  moves: `policy.ts` (the policy and runtime a spec implies), `coalescing.ts`
  (one judgment, however many askers), `expectations.ts` (what a store has to
  hand back), `judge.ts` (the two judgments one item needs), `derive.ts` (the
  pure re-derivation and the vector), `store.ts` (append-only, frozen) and
  `projections.ts` (what a record states). `apps/club/lib/longitudinal/jev.ts`
  splits into the adapter, `jevClient.ts` and `jevRecord.ts`.
- **Public surface:** unchanged, name for name, apart from the rename itself.
  The barrel re-exports the new modules with the same names `pipeline.ts` and
  `records.ts` used to carry; `coalesce`, `pendingFor` and everything in
  `expectations.ts` are internal to the fan-out and are deliberately not on it.
- **Types:** the Club adapter's dependency is narrowed from the `TypeSafeClient`
  class to `JevClient`, the `systemOne`/`withResponse()` surface it actually
  calls. The class has private members, so a test double could only ever be one
  through an `as unknown as` cast — and a cast through `unknown` type-checks
  against anything, including an SDK whose response shape has moved. The
  doubles now satisfy the port honestly and their bodies are checked against
  `SystemOneResult<...>`, so an SDK shape change fails `bun run typecheck`.
- **Numbers:** unchanged. No displayed score, run id, fingerprint or claim
  status moved: `tests/fixtures/longitudinal-golden.json`,
  `longitudinal-fingerprints.json`, `longitudinal-jev-request.json`,
  `run-ids-golden.json` and `demo-golden.txt` all pass without regeneration.
- **Projections:** `projectIdentity` and `projectClaim` now reject a confidence,
  a probability or a field match outside `[0, 1]`, and a score outside the
  rubric's `0..MAX_LEVEL`, with `JudgmentInvariantError`. A value outside its
  range is unrepresentable, so it is raised — never clamped, never coerced.
- **PR:** #54 T8.
