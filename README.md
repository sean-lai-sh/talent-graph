# Talent Graph

This is the **example admin of the club product**, sitting on the algorithm
engine. It is one product, not two frontends.

- **`apps/club/`** — the example admin. One Next.js app. `/` and `/example`
  are the public seed club (no sign-in). `/club` is a stub for a real
  organization later.
- **`src/`** — the **engine**. Pure TypeScript, no UI, no database. Every
  function is `(inputs, options) → result`. The admin imports it; the
  engine does not know about Next.

**Clerk and Neon come next.** They add sign-in and a database to this same
admin. They are **not a second frontend**. Do not add a login wall to the
public example.

Deploy is one Vercel project away. The settings that must be exact:

| Setting | Value |
|---|---|
| **Root Directory** | `apps/club` |
| **Include source files outside of the Root Directory in the Build Step** | ON |
| **`outputFileTracingRoot`** | repository root (`apps/club/next.config.ts`) |

Full dashboard and CLI steps:
[apps/club/README.md — Deploy on Vercel](apps/club/README.md#deploy-on-vercel-one-project-away).

- Theory (canonical): [`docs/theory/main.tex`](docs/theory/main.tex) · compiled
  [`talent_white_paper.pdf`](docs/theory/talent_white_paper.pdf)
- Scope reference: [`docs/mvp-coding-prompt.md`](docs/mvp-coding-prompt.md)
- Build plan and invariants: [`PLAN.md`](PLAN.md)
- Issue briefs: [`docs/issues/`](docs/issues/) · spec history:
  [`docs/models/CHANGELOG.md`](docs/models/CHANGELOG.md)

## 1. What this is

```sh
bun install
bun run lint        # biome
bun run typecheck   # tsc --noEmit
bun test            # 170+ tests, including invariant checks
bun run club:web    # Next.js example admin at http://127.0.0.1:3000
bun run demo        # dashboard + the six persona reports from the seed
bun run drift -- --kind referral_signal --before 0.1.0 --after 0.1.0
```

Import from the barrel:

```ts
import {
  generateSeed,
  computeAllReferralSignals,
  computeCapabilityVectors,
  underRecognitionGaps,
  selectComparisons,
} from "talent-graph"; // src/index.ts

const data = generateSeed();
const signals = computeAllReferralSignals(data.people, data.referrals);
const capability = computeCapabilityVectors(data.people, data.comparisons);
const gaps = underRecognitionGaps(signals, capability);
```

Tunables can be overridden with environment variables (Doppler project
`talent-graph`, config `dev`, or `.env.example`): `TG_BT_REGULARIZATION`,
`TG_BT_MAX_ITERATIONS`, `TG_BT_TOLERANCE`, `TG_MIN_COMPARISONS`,
`TG_MIN_OPPONENTS`, `TG_TOP_K_REFERRALS`. `loadConfig()` in `src/config.ts` is
the only reader of `process.env`; both
`doppler run --project talent-graph --config dev -- bun test` and plain
`bun test` work. A config that differs from the registered spec yields a spec
tagged `+env` so a run never claims to be a registered version with different
numbers.

**The exported `compute*` / `fit*` functions never read the environment.**
Called without a `spec`, they use the registered `CURRENT_SPECS`, whatever
`TG_*` says. `loadSpecs()` is the bridge: it reads the env once and returns
`{ config, referral_signal, bradley_terry }` for the caller to pass as
`spec:`.

```ts
import { loadSpecs, computeAllReferralSignals, computeCapabilityVectors } from "talent-graph";

const specs = loadSpecs(); // TG_* applied; versions tagged +env when they differ
const signals = computeAllReferralSignals(data.people, data.referrals, {
  spec: specs.referral_signal,
});
const capability = computeCapabilityVectors(data.people, data.comparisons, {
  spec: specs.bradley_terry,
});
```

`bun run demo` and `bun run drift` go through `loadSpecs()` (drift accepts
the literal version `env` for `--before` / `--after`, meaning "the current
registered spec with `TG_*` overrides applied"), so an override is visible in
both.

## 2. Product concept

The network already recognises some people; comparative judgment reveals
others. The two are measured separately and never merged:

```
Referral            ≠ Evaluation
Referral Signal     ≠ Capability Estimate
Rubric Evidence     ≠ Bradley–Terry Ranking
Missing Evidence    ≠ Low Ability
Model Estimate      ≠ Ground Truth
```

In code: `src/scoring/` (V0) and `src/inference/` (V1) never import each
other; the only places they meet are the exploratory
`src/analysis/underRecognition.ts`, presentation (`dashboard.ts`), and
bookkeeping (`drift.ts`, `modelRun.ts`). Rubric `Evaluation` records are
stored and summarised but feed no score. `affiliation` and `bio` are display
metadata that no scoring function reads. All of this is asserted by
`tests/invariants.test.ts`.

Approved vocabulary: **Referral Signal**, **Relative Capability Estimate**,
**Insufficient Evidence**, **Not Observed**, **Structured Evidence**,
**Under-Recognition Gap**, **Exploratory**. Avoid: "Talent Score",
"Intelligence Score", "Capability Score", "Objective Rank", "Human Value".

## 3. V0 model — Referral Signal

Deterministic and fully inspectable. The only V0 score.

```
n(x)  = (x − 1) / 4                                     x ∈ {1..5}
X_uv  = 0.50·n(conviction) + 0.30·n(confidence) + 0.20·n(relationshipDepth)
m_e   = { firsthand_work 1.00, firsthand_personal 0.90, artifact 0.85,
          reputation 0.60, other 0.70 }
R_uv  = X_uv · m_e                                      ∈ [0, 1]
p_u   = 1                                               (judge reliability not learned)
S_v   = mean(R_uv for u ∈ Top5(v))   ;  S_v = 0 if no referrals
ReferralSignal_v = 100 · S_v         (rounded only for display)
```

Shown alongside the number: the contributing referrals with their
breakdown, incoming count, firsthand count, strongest single referral, and
the distinct evidence types. Referral percentile (for §6 only) ranks `S_v`
among people with at least one referral; everyone else gets `null`.

Modules: `scoring/referralStrength.ts`, `scoring/referralSignal.ts`,
`scoring/referralPercentile.ts`. Weights come from the versioned
`ReferralSignalSpec` (§8), never from constants inside the math.

## 4. V1 model — Relative Capability

Pairwise comparison beats a 1–10 rating: people are far better at "who would
you trust more with X?" than at placing someone on an absolute scale, and the
answer needs no shared calibration between judges. Bradley–Terry turns those
answers into a latent ability per dimension.

```
P(i ≻ j | k) = σ(θ_ik − θ_jk)
L(θ) = −Σ_(w,l) logσ(θ_w − θ_l) + λ Σ_i θ_i²          λ = 0.1 by default
θ* = argmin L  subject to  Σ_i θ_i = 0   per connected component
```

- **Solver:** diagonal-Newton steps with Armijo backtracking on `L`
  (`inference/bradleyTerry.ts`). Every iteration strictly decreases the
  objective; convergence on `‖∇L‖∞ < 1e-6` or `maxIterations = 500`.
- **Centering is a constraint of the solve**, not a post-hoc shift: `L` is
  minimised on the hyperplane `Σθ = 0` within each component. With `κ = 0`
  this coincides with centering the unconstrained optimum; with an anchor
  prior (`κ > 0`, §8) the penalties are not translation-invariant and the
  constrained optimum is the one reported.
- **Numerics:** `logσ` is computed branch-on-sign (`inference/logistic.ts`);
  no NaN or ±Infinity for any finite input.
- **Observations:** only outcomes `a` / `b`. `tie` becomes two half-weight
  observations only when `tieHandling: "half"` (default `"ignore"`). `skip`
  and `insufficient_observation` are never observations. Comparison
  `confidence` is stored but ignored by the likelihood in V1.
- **Regularisation:** `λ = 0.1` is a modest default that keeps a node with a
  single comparison near 0 on the seed data. It has **not** been tuned
  against outcomes and is not theoretically optimal.
- **Connected components** are computed per dimension before fitting;
  groups that were never compared against each other share no scale, so each
  is fitted and ranked on its own (`inference/components.ts`).
- **Insufficient evidence:** fewer than `minComparisons = 3` comparisons, or
  fewer than `minOpponents = 2` distinct opponents, or nobody else estimable
  in the same component ⇒ `{ state: "insufficient_evidence", reason }` and no
  percentile.
- **Percentile:** rank among estimated members of the same component,
  `pct = 100·(rank − 1)/(n − 1)`, average ranks on ties.
- **Pool confidence** (a labelled heuristic, not theory): `high` if the pool
  has ≥15 people averaging ≥6 comparisons, `medium` if ≥6 people averaging
  ≥3, else `low`. The pool is the **estimated** members of the component —
  the people the percentile is ranked among (`poolSize`) — not the whole
  component (`componentSize`), which also counts members with insufficient
  evidence.

`computeCapabilityVectors` returns all seven dimensions per person and is
never collapsed to a scalar.

## 5. Comparison selection

```
Priority(i,j,k) = a·Uncertainty + b·Closeness + c·Novelty            a = b = c = 1
Uncertainty     = 1 / (1 + min(n_i, n_j))
Closeness       = exp(−|θ_i − θ_j|)          same component, both estimated
                = 0.5                        either side insufficient
                = 0.5·crossComponentBonus    different components
Novelty         = 1 if never compared on k, else min(1, daysSince / 30)
```

Heuristic, not optimal. Excludes self-pairs and the evaluator; `now` is a
parameter (`inference/comparisonSelection.ts`).

## 6. Under-recognition gap (exploratory)

```
U_ik = CapabilityPercentile_ik − ReferralPercentile_i
```

Computed only when the dimension estimate is `estimated` and the person has
at least one referral. Every entry carries `tag: "exploratory"` and the two
inputs that produced it. It is a diagnostic for studying the phenomenon, not
a production truth (`analysis/underRecognition.ts`).

## 7. Limitations

- Judge reliability is learned only from **referral** predictions scored
  against outcomes (§8); pairwise comparisons are not yet scored and V1
  ignores judge weights. Until outcomes exist every judge is weighted 1.
- Social correlation between referrers is ignored (no clique discount).
- Pairwise judgments are subjective and reflect what judges have observed.
- Outcome validation exists only through the judge loop; capability
  estimates themselves are not yet checked against what people later did.
- Estimates may reflect network bias: who gets compared depends on who is
  already visible.
- Every capability estimate is relative to the observed component, not to
  the world.
- `λ`, the thresholds, and the pool-confidence bands are defaults, not tuned.

## 8. V2 model — Judge calibration from outcomes

Every judge is weighted 1 in V0/V1 on purpose: the only signal inside the
graph is agreement, and weighting by agreement rewards the herd and punishes
the judge who spotted someone early. A judge can only be graded against what
happened afterwards. V2 does that at a time step `T`, following the white
paper's "Longitudinal Observation", "Learning Who Is Good at Identifying
Talent", "Shrinkage" and "Learning Judge Bias" sections:

```
R_v       realised outcome, rank-normalised within its kind        ∈ [0,1]  (kinds with < 3 outcomes ignored)
R*_uv   = R_v − E[R_v | O_v]                                        residual over v's outcomes observed
                                                                    after the referral (scored once
                                                                    T − t_uv ≥ 180 days); O_v at referral
truth_uv = cohort percentile of R*_uv                               ∈ [0,1]
x_uv    = R_uv  (the referral's unweighted V0 strength)             the prediction
E_uv    = (x_uv − truth_uv)²                                        one per (judge, candidate): earliest referral
Ē_u    ← (1−η)·Ē_u + η·E_uv          η = 0.3, chronological by first eligibility
p_u     = exp(−τ·Ē_u)                τ = 4
p̂_u     = n/(n+λ)·p_u + λ/(n+λ)·μ_p  λ = 3, μ_p = 1                  shrinkage against instant oracles
b̂_u     = shrunk running mean of (x_uv − truth_uv)                  signed bias, reported; applied if enabled
```

The Referral Signal then uses `p̂_u · clip(R_uv − b̂_u, 0, 1)` per referral.
With no outcomes, or `p̂ = 1, b̂ = 0`, that is exactly `R_uv`: **V2 reproduces
V0 bit-for-bit until evidence says otherwise** (asserted by tests).

- `E[R_v | O_v]` is the mean normalised outcome of people with a similar
  opportunity count (buckets `[1, 2, 3]`, global-mean fallback for small
  buckets). With no opportunity records it is a constant and the correction
  vanishes.
- **Labels are per prediction, not per person.** A referral is evaluable
  once `T − t_uv` has cleared the observation window. Its label is a causal
  cohort at the referral: only later outcomes, with kind ranks, `E[R|O]`
  buckets and residual percentiles all computed on that same cutoff, so a
  pre-referral track record cannot move `E_uv` even through the scale. The
  opportunity count is taken at the referral (`opportunityClock: "referral"`);
  `"outcome"` restores the person-level rule. The person-level snapshot
  (`residualOutcomes`) still uses everything and is for reporting. Zero-
  reliability judges are dropped from Top-K so they cannot dilute the mean.
- **One prediction per judge–candidate pair**, the earliest referral, matching
  the ingest invariant; a referral edited after creation is skipped by default
  because an edited row is not a frozen prediction. Skips are reported with a
  reason.
- Outcome kinds with fewer than `minKindSize = 3` measurable outcomes are
  ignored: a rank inside a one- or two-row kind is a cohort accident, not a
  scale. EWMA order uses the first instant the kind is rankable, not the
  first later outcome, so a delayed kind does not rewrite earlier updates.
- Truth comes from outcomes only, never from V1 capability estimates (which
  are built from judges' comparisons). `src/judges/` never imports
  `src/inference/`; the invariants test enforces it.
- Judge weights are passed *into* the Referral Signal; `src/scoring/` never
  imports `src/judges/`. A weighted `ModelRun` records the weights it used.
- Comparisons are not scored in 2.0.0. The paper specifies the referral case;
  scoring comparisons as forecasts is the natural extension.

```ts
import { computeJudgeCalibration, judgeWeightOptions, computeAllReferralSignals } from "talent-graph";

const calibration = computeJudgeCalibration({ people, referrals, outcomes, opportunities, now: T });
const weighted = computeAllReferralSignals(people, referrals, judgeWeightOptions(calibration));
```

`bun run demo` prints the calibrated judges at `T = 2026-12-31` on the seed
and the V0 vs V2 Referral Signal for the six personas.

## 9. Operational continuity — changing weights without destroying the graph

Weights and thresholds will change. A graph carrying months of observations
and real decisions must survive that without a silent reshuffle. Mechanism
(engineering, not theory; deliberately absent from `docs/theory/main.tex`):

1. **Raw observations are immutable and sufficient.** No score is stored on
   `Person`; everything is derived from raw records plus a spec.
2. **Models are versioned data.** `ModelSpec` objects (`src/models/spec.ts`)
   hold every weight, multiplier, λ and threshold under a semver. The
   registry (`src/models/registry.ts`) is append-only; `CURRENT_SPECS` names
   the default. Every math function accepts a `spec`.
3. **Every run is recorded.** `ModelRun` (`src/modelRun.ts`) stores the full
   spec, a SHA-256 of the stably-serialised inputs, and the outputs, so any
   historical number is reproducible exactly.
4. **Changes are measured before they are shown.** `analysis/drift.ts`
   compares two runs on the same data: Kendall τ_b, Spearman ρ, top-10/25
   Jaccard, shift distribution, people crossing the insufficient-evidence
   boundary, largest movers, and a `stable / review / breaking` verdict
   (heuristic thresholds: τ ≥ 0.9, top-10 Jaccard ≥ 0.7, p95 shift ≤ 10
   points; breaking below τ 0.7 or Jaccard 0.4). `bun run drift` prints it;
   the PR template requires a new spec version + CHANGELOG entry + drift
   report for any weight change.
5. **Transitions are gradual.** `fitBradleyTerry` accepts a previous run as
   a warm start and an optional anchor prior `κ·Σ(θ_i − θ_i^prev)²` (`κ = 0`
   reproduces the plain fit). `models/blend.ts` provides display-layer
   blending `(1 − α)·old + α·new` with linear or by-observation α schedules.
   **Blended values must be labelled as blended**, and both underlying runs
   are retained.
6. **Decisions keep their provenance.** `models/snapshot.ts` freezes the
   numbers a decision was made on, tied to `ModelRun` ids, so later spec
   versions never rewrite history.

## 10. Roadmap

| Version | Adds | Theory section in `docs/theory/main.tex` |
|---|---|---|
| V2 (shipped, §8) | Judge reliability `p_u`, shrinkage, bias `b_u`, opportunity-corrected residual `R*` from referral predictions | "Longitudinal Observation", "Learning Who Is Good at Identifying Talent", "Shrinkage", "Learning Judge Bias" |
| V3 | Comparisons scored as forecasts; clique / correlation discount `ρ`; prior shrinkage `W_v^(0)` | "Independence and Clique Discounting", "Learning Judge Bias" |
| V4 | Outcome validation of capability estimates, prediction scoring | "Reward Information Gain", "The Quantity Worth Optimizing" |
| V5 | Exploration policy | "The Self-Fulfilling Problem", "Exploration Versus Exploitation" |

`Outcome` and `Opportunity` are read by V2. `JudgeCalibration` and
`JudgeBias` are the persistable forms of V2's estimates. `PredictionSnapshot`
freezes decisions (§9).

## 11. Theory doc

`docs/theory/main.tex` is canonical. Any change to the theory must update it
in the same PR (the PR template has the checkbox), and CI builds the PDF and
checks that the committed copy is not older than the source
(`.github/workflows/theory.yml`, `scripts/check-theory-sync.ts`). The
coding prompt wins on scope; the LaTeX note wins on theory.
