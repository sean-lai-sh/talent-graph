# Talent Graph — V0 → V1 MVP Build Prompt

You are building **Talent Graph**, an experimental application for discovering unusually capable people through a directed referral graph, structured evidence, pairwise comparisons, and eventually longitudinal calibration.

A LaTeX design note is provided as the main theoretical reference.

Read it first.

However, **do not implement the entire theoretical system at once**.

The goal is to build the application in layers so that each algorithmic assumption can be tested independently.

The architecture should make it easy to replace or extend the scoring and inference systems later.

---

# 0. Core Philosophy

The system must distinguish between three fundamentally different concepts:

\[
\boxed{
\text{Referral Signal}
\neq
\text{Latent Capability}
\neq
\text{Observed Outcome}
}
\]

They answer different questions.

### Referral Signal

> How strongly does the network currently believe this person is worth investigating?

Derived from referrals.

### Latent Capability

> Given comparative observations, how strong does this person appear to be relative to others on a particular dimension?

Derived primarily from pairwise comparisons using a Bradley–Terry model.

### Observed Outcome

> What did this person actually do over time?

This becomes important in later versions for calibration.

Do not collapse these into one score.

---

# 1. Product Objective

The application should help a trusted network discover people whose:

\[
\text{actual capability}
\gg
\text{conventional legibility}
\]

The system should therefore prioritize:

- evidence,
- direct observation,
- comparative judgment,
- uncertainty,
- graph structure,

rather than prestige or credentials.

Company, university, job title, and affiliation may be displayed as context.

They must **not directly influence scores**.

---

# 2. Version Roadmap

Implement the project such that V0 and V1 are clearly separated.

## V0 — Observation Infrastructure

V0 provides:

- people / nodes,
- referrals / edges,
- evidence capture,
- structured behavioral rubric,
- deterministic Referral Signal,
- graph visualization,
- transparent score inspection.

V0 does **not attempt to estimate latent talent**.

## V1 — Comparative Capability Inference

V1 adds:

- pairwise comparisons,
- Bradley–Terry inference,
- per-dimension latent capability scores,
- ranking / percentile views,
- comparison selection,
- uncertainty / comparison count indicators.

V1 is the first version that attempts to infer relative capability.

Do not implement later systems yet:

- learned judge reliability,
- judge bias correction,
- clique correlation correction,
- opportunity adjustment,
- longitudinal backpropagation,
- causal inference,
- bandits,
- GNNs,
- LLM-as-judge.

The database should preserve enough raw information to support those later.

---

# 3. Recommended Technical Stack

Use:

- Next.js
- TypeScript
- React
- Tailwind CSS
- PostgreSQL
- Prisma ORM

Use PostgreSQL through Docker for local development if useful.

For graph visualization use a mature library such as:

- Cytoscape.js,
- React Flow,
- or equivalent.

Choose whichever integrates most cleanly.

Do **not** use Neo4j in V0/V1.

The graph is a conceptual data structure.

PostgreSQL is sufficient.

---

# 4. Architecture

Separate the application into three conceptual layers:

```text
raw human observations
        ↓
algorithm / inference modules
        ↓
application UI
```

Never embed mathematical scoring logic directly inside React components.

Suggested structure:

```text
/src
  /app
  /components
  /lib
    /scoring
      referralScore.ts
      types.ts

    /inference
      bradleyTerry.ts
      ranking.ts
      comparisonSelection.ts

    /graph
      graphUtils.ts

    /db
      ...

  /tests
    scoring.test.ts
    bradleyTerry.test.ts
```

The inference functions should ideally be pure functions.

Database retrieval should happen outside the mathematical core.

---

# 5. Core Data Model

## Person

```text
Person
------
id
name
bio
affiliation
status
createdAt
updatedAt
```

Status enum:

```text
candidate
member
archived
```

A person may simultaneously:

- receive referrals,
- make referrals,
- evaluate others,
- participate in pairwise comparisons.

A person is always a node in the same graph.

---

# 6. Referrals

A referral is a directed edge:

\[
u \rightarrow v
\]

meaning:

> Person \(u\) believes person \(v\) is worth investigating.

Schema:

```text
Referral
--------
id
referrerId
candidateId
conviction
confidence
relationshipDepth
evidenceType
evidenceText
createdAt
updatedAt
```

Constraints:

- no self-referral,
- prevent accidental duplicate referral from the same referrer to the same candidate,
- scores restricted to valid ranges.

---

# 7. Referral Priming Mechanism

The referral flow should begin with intuition rather than numbers.

Primary prompt:

> Who is one of the smartest, most unusually capable, or most under-recognized people you know whom we should meet?

Optional prompts:

- Who is much better than their credentials suggest?
- Who do you call when you're stuck on something genuinely difficult?
- Who has made you update your model of what one person can accomplish?
- Who becomes effective in unfamiliar domains unusually quickly?
- Who consistently sees something important before other people do?
- Who makes unusually strong people around them better?

Once a candidate is selected or created, ask prominently:

> What did you personally observe that caused you to believe this?

This evidence field should visually matter more than the numeric sliders.

---

# 8. Referral Fields

Use integer scales from 1–5.

## Conviction

```text
1 = mild recommendation
2 = thinks they are good
3 = strongly recommends
4 = unusually strong conviction
5 = "this person is exceptional; you should meet them"
```

## Confidence

```text
1 = speculative
2 = limited evidence
3 = moderate evidence
4 = strong evidence
5 = extensive direct evidence
```

## Relationship Depth

```text
1 = barely know them
2 = occasional interaction
3 = meaningful interaction
4 = worked closely together
5 = extensive firsthand collaboration
```

## Evidence Type

Enum:

```text
firsthand_work
firsthand_personal
artifact
reputation
other
```

---

# 9. V0 Referral Signal

Normalize a 1–5 input to \([0,1]\):

\[
n(x)=\frac{x-1}{4}
\]

For referral \(u \rightarrow v\), define:

\[
X_{uv}
=
0.50\,n(\text{conviction})
+
0.30\,n(\text{confidence})
+
0.20\,n(\text{relationshipDepth})
\]

Apply evidence multiplier:

\[
m_e =
\begin{cases}
1.00 & \text{firsthand\_work}\\
0.90 & \text{firsthand\_personal}\\
0.85 & \text{artifact}\\
0.60 & \text{reputation}\\
0.70 & \text{other}
\end{cases}
\]

Referral strength:

\[
\boxed{
R_{uv}=X_{uv}m_e
}
\]

In V0/V1:

\[
p_u=1
\]

for every referrer.

Do **not** yet learn judge quality.

---

# 10. Candidate Referral Signal

For candidate \(v\), order incoming referrals by \(R_{uv}\).

Take at most the five strongest:

\[
Top_5(v)
\]

Then:

\[
S_v
=
\frac{1}{|Top_5(v)|}
\sum_{u\in Top_5(v)}R_{uv}
\]

If the person has no referrals:

\[
S_v=0
\]

Display:

\[
ReferralSignal_v=100S_v
\]

Round only for presentation.

Preserve floating-point precision internally.

The UI must call this:

> **Referral Signal**

Never call it:

- Talent Score
- Intelligence Score
- Capability Score

Include explanatory text:

> Referral Signal summarizes the current strength of referral evidence. It is not an objective measure of ability.

---

# 11. Referral Signal Metadata

Alongside the score show:

- total incoming referrals,
- referrals used in Top 5,
- firsthand referral count,
- strongest referral,
- evidence types represented.

Example:

```text
Referral Signal
82

Evidence
4 incoming referrals
3 firsthand
strongest referral: 0.93
```

The application should always make the score inspectable.

---

# 12. Behavioral Rubric

Store structured observations across seven dimensions:

```text
problem_solving
learning_velocity
agency
taste
output
generativity
originality
```

Each accepts:

```text
N/O
0
1
2
3
4
```

Where:

```text
0 = strong evidence behavior is weak
1 = roughly ordinary relative to relevant peers
2 = clearly above ordinary peers
3 = unusually strong; experienced observers notice
4 = repeatedly surprising even to strong domain experts
N/O = not observed
```

Every numerical score may include:

- confidence: 1–5
- evidenceText

Schema:

```text
Evaluation
----------
id
evaluatorId
candidateId
dimension
score nullable
confidence nullable
evidenceText
createdAt
updatedAt
```

Important:

> Rubric scores should NOT affect Referral Signal in V0 or V1.

Store them as an independent evidence channel.

---

# 13. V1 — Pairwise Comparisons

V1 introduces pairwise comparison as the primary mechanism for estimating relative latent capability.

Humans are generally better at answering:

> Who is stronger on this specific dimension?

than:

> How talented is this person from 1–10?

Create a comparison entity:

```text
Comparison
----------
id
evaluatorId
personAId
personBId
dimension
winnerId
confidence
evidenceText nullable
createdAt
```

Constraints:

- personA != personB,
- winnerId must equal personAId or personBId,
- evaluator cannot compare themselves if desired,
- dimension must be one of the seven rubric dimensions.

Optionally support:

```text
tie
skip
insufficient_observation
```

Do not force evaluators to guess.

---

# 14. Pairwise Comparison UX

Present prompts such as:

### Problem solving

> Which person would you trust more with a genuinely difficult, ambiguous problem?

### Learning velocity

> Who becomes effective in an unfamiliar domain faster?

### Agency

> Who is more likely to turn an underspecified problem into concrete progress without needing direction?

### Taste

> Who more consistently chooses the right problems or approaches?

### Output

> Who more consistently turns ability into meaningful results?

### Generativity

> Who makes strong people around them substantially better?

### Originality

> Who more often produces useful ideas or frames that others did not see?

Allow:

```text
Person A
Person B
Not enough evidence
```

Optionally collect confidence:

```text
1–5
```

For V1, confidence may be stored without affecting the Bradley–Terry likelihood initially.

Keep the first implementation mathematically simple.

---

# 15. Bradley–Terry Model

For each dimension \(k\), assign every sufficiently connected person a latent parameter:

\[
\theta_{i,k}
\]

For a comparison where person \(i\) beats person \(j\):

\[
\boxed{
P(i \succ j \mid k)
=
\sigma(\theta_{i,k}-\theta_{j,k})
}
\]

where:

\[
\sigma(x)
=
\frac{1}{1+e^{-x}}
\]

Equivalent form:

\[
P(i \succ j)
=
\frac{e^{\theta_i}}
{e^{\theta_i}+e^{\theta_j}}
\]

Fit the parameters by maximizing log likelihood.

For one dimension:

\[
\boxed{
\theta^\ast
=
\arg\max_\theta
\sum_{(i,j)\in C}
\log P(i\succ j)
}
\]

where \(C\) is the set of observed comparisons.

---

# 16. Bradley–Terry Identifiability

Bradley–Terry parameters are translation invariant.

If:

\[
\theta_i'=\theta_i+c
\]

for every person, the probabilities do not change.

Therefore normalize fitted scores after optimization.

Use:

\[
\boxed{
\frac{1}{N}\sum_i\theta_i=0
}
\]

or equivalently subtract the mean after fitting.

---

# 17. Regularization

Real V1 data will be sparse.

Use modest L2 regularization:

\[
\mathcal L(\theta)
=
-\log P(C\mid\theta)
+
\lambda\sum_i\theta_i^2
\]

This prevents extreme scores for people with very few comparisons.

Make \(\lambda\) configurable.

Choose a reasonable default.

Document it clearly.

Do not pretend the default is theoretically optimal.

---

# 18. Disconnected Comparison Graphs

Bradley–Terry rankings are unreliable across disconnected components.

For each dimension:

construct graph

\[
G_k=(V_k,E_k)
\]

where an edge exists whenever two people have been compared on dimension \(k\).

Detect connected components.

If two people lie in disconnected components, do not imply their latent scores are strongly comparable.

The UI should indicate this.

Example:

```text
Problem Solving
Connected comparison pool: 37 people
Comparisons: 14
Confidence: medium
```

A person with only one comparison should not visually appear as equally well-established as someone with 40.

---

# 19. Capability Vector

For each person \(i\), infer:

\[
\boxed{
\mathbf{\theta}_i=
[
\theta_{i,\mathrm{problem}},
\theta_{i,\mathrm{learning}},
\theta_{i,\mathrm{agency}},
\theta_{i,\mathrm{taste}},
\theta_{i,\mathrm{output}},
\theta_{i,\mathrm{generativity}},
\theta_{i,\mathrm{originality}}
]
}
\]

Do not immediately collapse this into one scalar.

The vector is the primary representation.

A person may be:

- extremely strong in problem solving,
- average in leadership-like generativity,
- unknown in taste.

Preserve that structure.

---

# 20. Displaying Bradley–Terry Results

Do not expose raw \(\theta\) as something like:

```text
Talent = 2.4137
```

Instead display relative interpretation.

Preferred UI:

```text
Problem solving
Estimated percentile: 91st
Comparisons: 18
Unique opponents: 11

Learning velocity
Estimated percentile: 84th
Comparisons: 9

Generativity
Insufficient evidence
```

Percentiles may be computed by ranking \(\theta\) values within the connected comparison population for that dimension.

Clearly label:

> Relative Capability Estimate

Include:

> This estimate is inferred from pairwise comparisons within the observed network and should not be interpreted as an absolute measure of ability.

---

# 21. Referral Signal and Capability Must Stay Separate

This is a central architecture constraint.

A candidate could have:

```text
Referral Signal: 94
Problem solving percentile: unknown
```

because many people strongly recommended them but pairwise evidence is not yet available.

Another person could have:

```text
Referral Signal: 58
Problem solving percentile: 96th
```

because the referral network did not initially notice them strongly, but comparative evidence suggests unusual capability.

This mismatch is valuable information.

Do not automatically combine the two.

---

# 22. Interesting Derived Signal

Create an experimental field:

> **Under-recognition gap**

Conceptually:

\[
U_{i,k}
=
CapabilityPercentile_{i,k}
-
ReferralPercentile_i
\]

Do not treat this as a production truth.

Use it as an exploratory diagnostic.

A large positive value may indicate:

\[
\text{comparative capability}
\gg
\text{network recognition}
\]

which is precisely the kind of node the system is interested in finding.

Only calculate this when enough comparison data exists.

---

# 23. Comparison Selection

Do not generate pairwise questions completely randomly.

Implement a simple V1 comparison selector.

Prefer pairs where:

1. both people have been observed on the requested dimension,
2. they have not been compared recently,
3. their current \(\theta\) estimates are relatively close,
4. one or both have relatively few comparisons.

Conceptually:

\[
Priority(i,j)
=
a\,Uncertainty(i,j)
+
b\,Closeness(i,j)
+
c\,Novelty(i,j)
\]

Do not over-engineer this.

A heuristic implementation is sufficient.

The goal is simply to generate comparisons that provide useful information.

---

# 24. V1 Screens

## Dashboard

Show:

- number of people,
- candidates,
- members,
- referrals,
- comparisons,
- recent referrals,
- high Referral Signal candidates,
- high latent-capability candidates,
- potentially under-recognized candidates.

---

## People List

Columns:

- name,
- status,
- affiliation,
- Referral Signal,
- incoming referrals,
- selected capability dimension,
- comparison count,
- created date.

Allow sorting and filtering.

---

# 25. Person Detail Page

This should be the core interface.

Show:

## Identity

- name
- bio
- affiliation
- status

## Referral Signal

- score,
- incoming referral count,
- firsthand count.

## Why this signal exists

Show Top 5 contributing referrals.

For each:

- referrer,
- referral score,
- conviction,
- confidence,
- relationship depth,
- evidence type,
- evidence text.

## Relative Capability

Display all seven Bradley–Terry dimensions.

For each:

- percentile,
- latent score internally,
- comparison count,
- unique opponents,
- insufficient-evidence state.

## Structured Evidence

Show rubric observations.

## Pairwise History

Show comparisons involving this person.

## Graph Neighborhood

Show:

- people who referred them,
- people they referred.

---

# 26. Graph View

Build an interactive directed referral graph.

Nodes:

```text
Person
```

Edges:

```text
Referral
```

Node size may correspond loosely to incoming referral count.

Edge thickness may correspond to \(R_{uv}\).

Do not encode Bradley–Terry ranking into graph position.

Graph layout is visual only.

Clicking a person should open their detail page.

Allow filtering by:

- candidate/member,
- minimum Referral Signal,
- affiliation,
- evidence type.

---

# 27. Bradley–Terry Implementation API

Create an inference module such as:

```text
/lib/inference/bradleyTerry.ts
```

Suggested API:

```ts
type ComparisonObservation = {
  winnerId: string;
  loserId: string;
};

type BradleyTerryResult = {
  personId: string;
  theta: number;
  percentile: number;
  comparisonCount: number;
  opponentCount: number;
  componentId: string;
};

fitBradleyTerry(
  personIds: string[],
  comparisons: ComparisonObservation[],
  options?: {
    regularization?: number;
    maxIterations?: number;
    tolerance?: number;
  }
): BradleyTerryResult[];
```

Implementation may use:

- gradient ascent/descent,
- Newton-style optimization,
- MM optimization,
- or another correct numerical approach.

Prefer a transparent implementation over a heavy ML dependency.

Add comments explaining the math.

---

# 28. Numerical Stability

Implement the Bradley–Terry likelihood carefully.

Avoid naïve:

```ts
Math.log(1 / (1 + Math.exp(-x)))
```

when numerical overflow may occur.

Implement stable log-sigmoid calculations.

Add tests with extreme \(\theta\) differences.

---

# 29. Tests for Bradley–Terry

At minimum test:

### Test 1

A consistently beats B.

Expected:

\[
\theta_A>\theta_B
\]

### Test 2

A beats B, B beats C repeatedly.

Expected approximately:

\[
\theta_A>\theta_B>\theta_C
\]

### Test 3

Symmetric wins between A and B.

Expected:

\[
\theta_A\approx\theta_B
\]

### Test 4

Adding a constant to every \(\theta\) should not affect probabilities.

Normalization should give approximately zero mean.

### Test 5

Sparse nodes should remain closer to zero due to regularization.

### Test 6

Disconnected comparison groups should be detected.

### Test 7

Repeated observations should increase ordering confidence.

### Test 8

Extreme values should not produce NaN / Infinity.

---

# 30. Seed Data

Create realistic synthetic seed data.

At minimum:

- 25–40 people,
- 40+ referrals,
- 100+ pairwise comparisons,
- multiple dimensions,
- some sparse candidates,
- some heavily compared candidates.

Include intentionally interesting cases:

### Candidate A

High Referral Signal + high pairwise capability.

### Candidate B

High Referral Signal + mediocre pairwise capability.

### Candidate C

Low Referral Signal + very high capability estimate.

### Candidate D

One extremely strong referral but little other evidence.

### Candidate E

Many mediocre referrals.

### Candidate F

Strong in problem solving but weak / unknown in generativity.

This helps visually inspect whether the application communicates the distinction between referral and inferred capability.

---

# 31. What NOT to Implement Yet

Do not implement:

## Judge reliability

Later:

\[
p_u
\]

will be learned from historical predictive accuracy.

For now:

\[
p_u=1.
\]

## Judge bias

Do not estimate:

\[
b_u
\]

yet.

## Clique discounting

Do not yet estimate:

\[
\rho_{uv}
\]

or social-correlation penalties.

## Longitudinal outcomes

Do not yet backpropagate six-month outcomes.

## Opportunity adjustment

Do not yet estimate:

\[
R_v^\ast
=
R_v-
\mathbb E[R_v\mid O_v].
\]

## Exploration policy

Do not yet introduce bandits.

## LLM judgment

An LLM should not assign capability scores.

---

# 32. Future Architecture Compatibility

Even though these systems are not yet implemented, structure the data model so later versions can add:

```text
Outcome
Opportunity
JudgeCalibration
JudgeBias
PredictionSnapshot
ModelRun
```

Do not hard-code the current scoring outputs onto Person as permanent truth.

Prefer derived results or model-run tables.

Ideally support something like:

```text
ModelRun
--------
id
modelType
modelVersion
parameters
createdAt
```

so future model outputs can be reproduced.

---

# 33. Explainability Requirement

Every displayed numerical result must be inspectable.

For Referral Signal:

show the referrals responsible.

For Relative Capability:

show:

- comparison count,
- opponents,
- dimension,
- recent comparison outcomes,
- connected comparison pool.

Never present unexplained numbers.

---

# 34. Important Product Language

Avoid language suggesting objective human ranking.

Prefer:

```text
Referral Signal
Relative Capability Estimate
Evidence
Observed Dimensions
Comparison Count
Confidence
Insufficient Evidence
```

Avoid:

```text
Talent Score
Human Value
Intelligence Score
Objective Rank
```

The system is estimating noisy latent variables from limited observations.

The UI should reflect that epistemic uncertainty.

---

# 35. V0 Completion Criteria

V0 is complete when:

- people can be created,
- people can refer other people,
- evidence is stored,
- Referral Signal is calculated correctly,
- rubric observations can be stored,
- graph visualization works,
- person pages explain their Referral Signal,
- tests pass.

---

# 36. V1 Completion Criteria

V1 is complete when:

- users can make pairwise judgments by dimension,
- comparisons are stored,
- Bradley–Terry parameters can be fitted independently per dimension,
- scores are normalized,
- regularization exists,
- disconnected comparison components are handled,
- capability percentiles are displayed,
- sparse data produces an insufficient-evidence state,
- Referral Signal remains separate,
- under-recognition can be explored,
- inference tests pass.

---

# 37. Development Order

Implement in this order.

## Phase A — Foundation

1. initialize Next.js / TypeScript project,
2. configure database and Prisma,
3. implement schema,
4. create seed script.

## Phase B — V0

5. people CRUD,
6. referral creation flow,
7. referral scoring engine,
8. structured evaluation form,
9. person detail page,
10. dashboard,
11. referral graph,
12. scoring tests.

## Phase C — V1

13. Comparison schema and API,
14. comparison UI,
15. Bradley–Terry inference module,
16. regularization,
17. connected-component detection,
18. capability vector computation,
19. percentile mapping,
20. capability UI,
21. comparison-selection heuristic,
22. under-recognition exploratory view,
23. inference tests.

Do not skip directly to sophisticated modeling.

---

# 38. README Requirements

Write a strong README explaining:

## Product concept

Why Referral Signal and Relative Capability are separate.

## V0 model

Document:

\[
R_{uv}
\]

and:

\[
S_v.
\]

## V1 model

Explain:

\[
P(i\succ j)
=
\sigma(\theta_i-\theta_j).
\]

Explain why the model uses pairwise comparisons rather than absolute 1–10 ratings.

Explain regularization and normalization.

## Limitations

Explicitly state:

- judges are currently equally weighted,
- social correlation is ignored,
- pairwise rankings remain subjective,
- outcome validation does not yet exist,
- the system may reflect network bias,
- capability estimates are relative to the observed graph.

## Roadmap

Describe:

```text
V2 — judge calibration
V3 — bias / clique correction
V4 — longitudinal outcomes
V5 — opportunity correction + exploration
```

---

# 39. Coding Style

Prefer:

- small modules,
- explicit types,
- deterministic pure functions,
- readable math,
- tests,
- simple abstractions.

Avoid:

- premature distributed architecture,
- excessive generic abstractions,
- giant service classes,
- unnecessary microservices,
- ML frameworks where simple numerical code works,
- coupling the UI directly to the scoring model.

Document mathematical functions clearly.

---

# 40. Core Conceptual Invariants

The following invariants should remain true throughout the codebase:

\[
\boxed{
\text{Referral} \neq \text{Evaluation}
}
\]

\[
\boxed{
\text{Referral Signal} \neq \text{Capability Estimate}
}
\]

\[
\boxed{
\text{Rubric Evidence} \neq \text{Bradley--Terry Ranking}
}
\]

\[
\boxed{
\text{Missing Evidence} \neq \text{Low Ability}
}
\]

\[
\boxed{
\text{Model Estimate} \neq \text{Ground Truth}
}
\]

These distinctions are central to the project.

---

# 41. Final Goal of This Build

At the end of V1, the system should allow us to observe something like:

```text
Alice

Referral Signal
78 / 100
3 incoming referrals
2 firsthand

Relative Capability

Problem Solving
93rd percentile
18 comparisons

Learning Velocity
88th percentile
11 comparisons

Agency
79th percentile
8 comparisons

Taste
Insufficient evidence

Interesting signal:
Pairwise capability estimate substantially exceeds referral recognition.
```

The application should make it possible to ask:

> Who does the network already recognize?

and separately:

> Who appears unusually capable once people are forced to make comparative judgments?

The gap between those two is one of the core phenomena the project is intended to study.

---

# 42. Before Coding

Before implementation, inspect the attached LaTeX theory document.

Then:

1. summarize the architecture you intend to build,
2. identify any technical assumptions you need to make,
3. create the project structure,
4. implement V0,
5. verify V0 tests,
6. implement V1,
7. verify Bradley–Terry behavior on synthetic seed data,
8. document known limitations.

Do not silently invent additional theory.

When the design note and this prompt differ in scope, follow this prompt for implementation scope while preserving compatibility with the larger theory.

The purpose of V0/V1 is not to prove the talent model is correct.

The purpose is to build a **clean experimental apparatus with which the model can begin being falsified.**