# Talent Graph — Algorithm Core: Build Plan

**Scope of this repo (for now): the algorithm layer only.**
No Next.js, no Prisma, no Postgres, no UI. This package is the pure, testable
mathematical core that a later application will import. Everything here is
plain TypeScript run with **Bun** (`bun test`, `bun run`).

Theory reference: [`docs/theory/main.tex`](docs/theory/main.tex) (compiled copy:
[`docs/theory/talent_white_paper.pdf`](docs/theory/talent_white_paper.pdf)).
Implementation scope reference: [`docs/mvp-coding-prompt.md`](docs/mvp-coding-prompt.md).
When the two differ, the coding prompt wins on scope; the LaTeX note wins on
theory and on compatibility with later versions. **The LaTeX source is
versioned in this repo and must stay in sync with any theory changes.**

---

## 1. Core invariants (never violate)

```
Referral            ≠ Evaluation
Referral Signal     ≠ Capability Estimate
Rubric Evidence     ≠ Bradley–Terry Ranking
Missing Evidence    ≠ Low Ability
Model Estimate      ≠ Ground Truth
```

Concretely, in code:

- `scoring/` (Referral Signal) and `inference/` (Bradley–Terry) never import
  from each other. The only places they meet are explicit and enumerated in
  `tests/invariants.test.ts`: `analysis/underRecognition.ts` (the diagnostic,
  explicitly labelled exploratory), `analysis/dashboard.ts` (presentation of
  both, computes nothing), `analysis/reviewQueue.ts` (categorical review
  buckets, no merged number), `analysis/drift.ts` and `modelRun.ts`
  (bookkeeping: comparing and recording runs of either kind), and `index.ts`
  (the public barrel).
- Rubric `Evaluation` records are stored and summarised but feed **no** score.
- Affiliation / credentials are display metadata; no function in `src/` reads
  them to compute a number.
- All inference functions are pure: `(inputs, options) → result`. No I/O, no
  globals, no `Date.now()` inside math (time is passed in).
- Every numeric output is accompanied by the evidence that produced it
  (contributing referrals, comparison counts, opponents, component id).

## 2. Package layout

```
talent-graph/
  package.json            # bun, "type": "module", scripts: test, typecheck, lint, seed
  tsconfig.json           # strict, NodeNext, noUncheckedIndexedAccess
  bunfig.toml             # test config
  src/
    index.ts              # public barrel export
    domain/
      types.ts            # Person, Referral, Evaluation, Comparison, enums, Dimension
      constants.ts        # DIMENSIONS, EVIDENCE_MULTIPLIER, prompts text
      validate.ts         # runtime guards: ranges, no self-referral, winner∈{A,B}
    scoring/              # V0 — Referral Signal
      referralStrength.ts # R_uv = X_uv * m_e
      referralSignal.ts   # S_v = mean(Top5 R_uv), metadata, explanation
      referralPercentile.ts
    inference/            # V1 — Relative Capability
      logistic.ts         # stable sigmoid / logSigmoid
      components.ts       # connected components of comparison graph per dimension
      bradleyTerry.ts     # fitBradleyTerry(personIds, comparisons, options)
      percentile.ts       # rank → percentile within a component
      capabilityVector.ts # per-person 7-dim vector w/ insufficient-evidence states
      comparisonSelection.ts # heuristic pair selector
    analysis/
      underRecognition.ts # U_{i,k} = capPct − referralPct (exploratory)
      dashboard.ts        # aggregate summaries for a future UI
    graph/
      referralGraph.ts    # adjacency, in/out neighbourhoods, filters
    seed/
      generate.ts         # deterministic synthetic dataset (seeded PRNG)
      personas.ts         # Candidates A–F as specified
    modelRun.ts           # ModelRun record: modelType, version, params, outputs
  tests/
    scoring.test.ts
    bradleyTerry.test.ts
    components.test.ts
    percentile.test.ts
    comparisonSelection.test.ts
    underRecognition.test.ts
    seed.test.ts
    invariants.test.ts    # import-boundary + language checks
  scripts/
    demo.ts               # bun run demo → prints "Alice" style report from seed
  docs/
    theory/main.tex, talent_white_paper.pdf
    mvp-coding-prompt.md
    issues/*.md           # one file per GitHub issue (source of truth for gh)
  README.md
  PLAN.md
```

## 3. Data model (in-memory types; DB-agnostic)

These are TypeScript types only. They mirror the prompt's schema so a future
Prisma schema is a 1:1 mapping. IDs are opaque strings.

```ts
type PersonStatus = "candidate" | "member" | "archived";
type EvidenceType = "firsthand_work" | "firsthand_personal" | "artifact" | "reputation" | "other";
type Dimension = "problem_solving" | "learning_velocity" | "agency" | "taste"
               | "output" | "generativity" | "originality";
type Scale5 = 1 | 2 | 3 | 4 | 5;
type RubricScore = 0 | 1 | 2 | 3 | 4;        // null ⇒ N/O
type ComparisonOutcome = "a" | "b" | "tie" | "skip" | "insufficient_observation";

Person      { id, name, bio?, affiliation?, status, createdAt, updatedAt }
Referral    { id, referrerId, candidateId, conviction: Scale5, confidence: Scale5,
              relationshipDepth: Scale5, evidenceType, evidenceText, createdAt, updatedAt }
Evaluation  { id, evaluatorId, candidateId, dimension, score: RubricScore | null,
              confidence: Scale5 | null, evidenceText, createdAt, updatedAt }
Comparison  { id, evaluatorId, personAId, personBId, dimension, outcome,
              winnerId: string | null, confidence: Scale5 | null, evidenceText?, createdAt }
ModelRun    { id, modelType, modelVersion, parameters, inputHash, createdAt, outputs }
```

Future-compat placeholders (types only, no logic): `Outcome`, `Opportunity`,
`JudgeCalibration`, `JudgeBias`, `PredictionSnapshot`.

## 4. V0 — Referral Signal (deterministic)

```
n(x) = (x − 1) / 4                                   for x ∈ {1..5}
X_uv = 0.50·n(conviction) + 0.30·n(confidence) + 0.20·n(relationshipDepth)
m_e  = { firsthand_work 1.00, firsthand_personal 0.90, artifact 0.85,
         reputation 0.60, other 0.70 }
R_uv = X_uv · m_e                                     ∈ [0, 1]
p_u  = 1  (judge reliability is NOT learned in V0/V1)
S_v  = mean(R_uv for u ∈ Top5(v))  ;  S_v = 0 if no referrals
ReferralSignal_v = 100 · S_v   (round only for display)
```

Output object: `{ personId, signal, contributing: Referral[] (≤5, sorted desc),
incomingCount, firsthandCount, strongest, evidenceTypes }`.

Referral percentile (needed only for under-recognition): rank of `S_v` among
all people with ≥1 incoming referral. People with zero referrals get
`referralPercentile = null` (missing ≠ low).

## 5. V1 — Relative Capability (Bradley–Terry per dimension)

```
P(i ≻ j | k) = σ(θ_ik − θ_jk)
L(θ) = −Σ log σ(θ_w − θ_l)  +  λ Σ θ_i²          (λ default 0.1, configurable)
θ* = argmin L ;  then θ ← θ − mean(θ)   (per connected component)
```

- Solver: gradient descent with backtracking or simple Newton diagonal step;
  transparent, commented, no ML deps. Convergence on `‖∇L‖∞ < tol` or
  `maxIterations`.
- Numerics: `logSigmoid(x) = x < 0 ? x − log1p(exp(x)) : −log1p(exp(−x))`.
  Must never produce NaN/±Infinity for |Δθ| up to 1e3.
- Only outcomes `a`/`b` become observations. `tie` → optional half-win each
  (flag `tieHandling: "ignore" | "half"`, default `"ignore"`). `skip` and
  `insufficient_observation` are never observations.
- Confidence is **stored but ignored** by the likelihood in V1.
- Connected components computed per dimension **before** fitting; fit per
  component; percentiles are ranks **within the component**.
- Insufficient evidence: a person with `< minComparisons` (default 3) or
  `< minOpponents` (default 2) on a dimension gets
  `{ state: "insufficient_evidence" }` and no percentile.
- Pool confidence label: heuristic on pool size + comparisons/person
  (`low` / `medium` / `high`), documented as a heuristic. The pool is the
  *estimated* members of the component — the people the percentile is
  actually ranked among — not the whole component (this supersedes the
  `componentSize` wording in issue #6).

Result per (person, dimension): `{ theta, percentile, comparisonCount,
opponentCount, componentId, componentSize, poolSize, poolConfidence, state }`.

`capabilityVector(personId)` returns all 7 dimensions; never collapsed to a
scalar.

## 6. Comparison selection heuristic

```
Priority(i,j,k) = a·Uncertainty + b·Closeness + c·Novelty
Uncertainty = 1 / (1 + min(n_i, n_j))            (few comparisons ⇒ high)
Closeness   = exp(−|θ_i − θ_j|)                   (same component; else 0.5 cross-component bonus optional)
Novelty     = 1 if never compared on k, else min(1, daysSince(lastInformativeComparison) / 30)
```
Defaults `a=b=c=1`, configurable. "Informative" means an `a`/`b`/`tie`
outcome: `skip` and `insufficient_observation` do not count as having
compared the pair, so a pair that was only ever skipped stays fully novel.
`now` is passed in, never read from the clock. Returns top-N candidate pairs
with the prompt text for that dimension. Excludes `i === j` and
evaluator-self pairs when an evaluator id is supplied.

## 7. Under-recognition gap (exploratory)

```
U_ik = CapabilityPercentile_ik − ReferralPercentile_i
```
Computed only when both sides exist (person has ≥1 referral and a
non-insufficient BT estimate on k). Returned with an explicit
`"exploratory"` tag and the two inputs that produced it.

## 8. Seed data

Deterministic (seeded PRNG, e.g. mulberry32), ~32 people, ~50 referrals,
~160 comparisons across all 7 dimensions, including the required personas:

| Persona | Referral Signal | Pairwise capability |
|---|---|---|
| A | high | high |
| B | high | mediocre |
| C | low | very high |
| D | one very strong referral only | little |
| E | many mediocre referrals | — |
| F | — | strong problem_solving, unknown generativity |

`bun run demo` prints the "Alice" style report for A–F so the distinction
is visually checkable without a UI.

## 9. Tests (bun test)

Scoring: normalisation, weights, multiplier, Top5 truncation, zero-referral
case, rounding only at display, self-referral/duplicate rejection.

Bradley–Terry (the 8 mandated tests): A≫B ordering; transitive chain;
symmetric ⇒ ≈ equal; translation invariance + zero mean; regularisation
shrinks sparse nodes; disconnected components detected; more data ⇒ larger
gap; extreme values no NaN/Inf. Plus: tie handling, skip ignored, percentile
within component only.

Invariants test: greps `src/scoring` for imports of `src/inference` and vice
versa; greps `src/` for banned strings ("Talent Score", "Intelligence Score",
"Capability Score", "Objective Rank").

## 10. Tooling

- Bun 1.4 (`bun init`), TypeScript strict, `bun test`, `tsc --noEmit`.
- Biome for lint/format (single tool, fast).
- GitHub Actions: `bun install && bun run typecheck && bun test` on push/PR.
- Doppler project `talent-graph` (config `dev`) holds tunables as env vars so
  a future app can override defaults without code changes:
  `TG_BT_REGULARIZATION`, `TG_BT_MAX_ITERATIONS`, `TG_BT_TOLERANCE`,
  `TG_MIN_COMPARISONS`, `TG_MIN_OPPONENTS`, `TG_TOP_K_REFERRALS`.
  Code reads these via `src/config.ts` with hard-coded defaults; Doppler is
  optional at runtime (`doppler run -- bun test` works, plain `bun test` works).
- LaTeX: `docs/theory/main.tex` is canonical; no local TeX toolchain is
  assumed. A CI job compiles it with a `texlive` container and uploads the PDF
  as an artifact so the committed PDF can be refreshed on demand.

## 11. Scope beyond V1

**In scope since V2 (issue #16, `src/judges/`):** longitudinal `Outcome` /
`Opportunity` records, opportunity-corrected residual `R*_v`, judge
reliability `p_u = exp(−τĒ_u)` from referral prediction error with shrinkage
toward `μ_p = 1`, judge bias `b_u`, and the `p̂_u · clip(R_uv − b̂_u)` hook in
the Referral Signal. Truth comes from outcomes only; `src/judges/` never
imports `src/inference/` and `src/scoring/` never imports `src/judges/`.

**Explicitly out of scope (V3+):** scoring pairwise comparisons as forecasts,
clique/correlation discount `ρ`, `d_uv`, prior shrinkage
`W_v^(0) = (1−c)μ + cS`, judge weights inside the V1 likelihood,
bandits/exploration policy, GNNs, LLM-as-judge.

## 11a. Durable updates: changing weights without destroying the graph

The weights, thresholds, and eventually the model form *will* change. A graph
carrying months of observations and real decisions must survive that without a
silent reshuffle. Mechanism (issue #15):

1. **Raw observations are immutable and sufficient.** Scores are never stored
   on `Person`; everything is derived and reproducible from raw data + a spec.
   Recomputing is cheap. The cost we control is *semantic drift*.
2. **Models are versioned data.** `ModelSpec` objects (`src/models/spec.ts`,
   append-only `registry.ts`) hold every weight, multiplier, λ and threshold
   with a semver. Math functions take a spec; defaults come from `CURRENT_SPECS`.
3. **Every run is recorded.** `ModelRun` stores spec version + parameters +
   input hash + outputs, so any historical number can be reproduced exactly.
4. **Changes are measured before they are shown.** `analysis/drift.ts` compares
   two runs on the same data: Kendall τ, Spearman, top-K Jaccard, percentile
   shift distribution, people crossing the insufficient-evidence boundary,
   largest movers, and a `stable / review / breaking` verdict with documented
   heuristic thresholds. `bun run drift` prints it; a PR checkbox requires it.
5. **Transitions are gradual.** Bradley–Terry accepts a previous run as a
   warm start and an optional anchor prior `κ·Σ(θ_i − θ_i^prev)²` (κ = 0 ⇒
   plain fit). Display-layer blending `(1−α)·old + α·new` with a scheduled α is
   available for rollout, always labelled, with both raw runs retained.
   The objective is minimised **subject to Σθ = 0 per connected component**
   (a constrained solve, not post-hoc centering): with κ = 0 the two agree,
   but with κ > 0 the penalties are not translation-invariant, so centering
   after the fact would not be the optimum.
6. **Decisions keep their provenance.** `PredictionSnapshot` freezes the
   numbers a decision was made on, tied to `ModelRun` ids, so later spec
   versions never rewrite history.

Anchoring and blending are engineering continuity devices, not theory; they
are documented in README, not in `docs/theory/main.tex`.

## 12. Work breakdown → GitHub issues

Each issue in `docs/issues/` is a self-contained brief for a cloud coding
agent: goal, files to touch, exact formulas, acceptance tests, and what not
to do. Ordering:

| # | GH | Issue | Depends on |
|---|---|---|---|
| 1 | #14 | Scaffold: bun, tsconfig, biome, CI, README skeleton | — |
| 2 | #1 | Domain types, constants, validation | 1 |
| 3 | #2 | V0 referral strength + Referral Signal + explanation | 2 |
| 4 | #3 | Referral graph utilities | 2 |
| 5 | #4 | Stable logistic helpers + connected components | 2 |
| 6 | #5 | Bradley–Terry fit (regularised, normalised, per-component) | 5 |
| 7 | #6 | Percentiles, capability vector, insufficient-evidence states | 6 |
| 8 | #7 | Comparison selection heuristic | 7 |
| 9 | #8 | Referral percentile + under-recognition gap | 3, 7 |
| 10 | #9 | Seeded synthetic dataset with personas A–F | 2 |
| 11 | #10 | ModelRun record + config (Doppler-backed tunables) | 6 |
| 12 | #11 | Demo script + dashboard summaries | 3, 7, 9, 10 |
| 13 | #12 | Invariant tests + README math/limitations/roadmap | all |
| 14 | #13 | LaTeX CI build job + theory-sync check | 1 |
| 15 | #15 | Durable updates: versioned specs, drift report, anchored refit, blending | 2, 6, 11 |

Phase A = issues 1–2. Phase B (V0) = 3, 4, 10. Phase C (V1) = 5–9, 11–12.
Closeout = 13–14. Cross-cutting = 15 (land after 6 and 11, before 12–13).
