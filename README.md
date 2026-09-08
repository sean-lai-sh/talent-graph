# Talent Graph — Algorithm Core

**This repo is the algorithm core only** — no UI, no database, no application
framework. It is a Bun + TypeScript library with zero runtime dependencies that
a later application imports. Every function is pure: `(inputs, options) → result`.

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
θ* = argmin L ;  θ ← θ − mean(θ)   per connected component
```

- **Solver:** diagonal-Newton steps with Armijo backtracking on `L`
  (`inference/bradleyTerry.ts`). Every iteration strictly decreases the
  objective; convergence on `‖∇L‖∞ < 1e-6` or `maxIterations = 500`.
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
  ≥3, else `low`.

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

- Judges are equally weighted (`p_u = 1`); reliability is not learned.
- Social correlation between referrers is ignored (no clique discount).
- Pairwise judgments are subjective and reflect what judges have observed.
- No outcome validation yet: nothing here has been checked against what
  people later did.
- Estimates may reflect network bias: who gets compared depends on who is
  already visible.
- Every capability estimate is relative to the observed component, not to
  the world.
- `λ`, the thresholds, and the pool-confidence bands are defaults, not tuned.

## 8. Operational continuity — changing weights without destroying the graph

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

## 9. Roadmap

| Version | Adds | Theory section in `docs/theory/main.tex` |
|---|---|---|
| V2 | Judge calibration `p_u` learned from outcomes | "Learning Who Is Good at Identifying Talent" |
| V3 | Judge bias `b_u`, clique / correlation discount `ρ`, shrinkage `W_v^(0)` | "Learning Judge Bias", "Independence and Clique Discounting", "Shrinkage" |
| V4 | Longitudinal outcomes and prediction scoring | "Longitudinal Observation", "Reward Information Gain" |
| V5 | Opportunity correction `R*`, exploration policy | "The Self-Fulfilling Problem", "Exploration Versus Exploitation" |

The placeholder types `Outcome`, `Opportunity`, `JudgeCalibration`,
`JudgeBias`, `PredictionSnapshot` exist now so a database can be shaped for
them; no logic reads them except snapshot creation.

## 10. Theory doc

`docs/theory/main.tex` is canonical. Any change to the theory must update it
in the same PR (the PR template has the checkbox), and CI builds the PDF and
checks that the committed copy is not older than the source
(`.github/workflows/theory.yml`, `scripts/check-theory-sync.ts`). The
coding prompt wins on scope; the LaTeX note wins on theory.
