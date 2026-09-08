# Domain types, constants, and validation guards

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/1

**Phase A · depends on: #14**

## Goal
Define the in-memory data model that mirrors the MVP prompt schema 1:1 (so a later Prisma schema is a direct mapping), plus runtime validators. Types only for future-version entities.

## Files
### `src/domain/types.ts`
```ts
export type PersonStatus = "candidate" | "member" | "archived";
export type EvidenceType = "firsthand_work" | "firsthand_personal" | "artifact" | "reputation" | "other";
export type Dimension = "problem_solving" | "learning_velocity" | "agency" | "taste" | "output" | "generativity" | "originality";
export type Scale5 = 1 | 2 | 3 | 4 | 5;
export type RubricScore = 0 | 1 | 2 | 3 | 4;   // null in Evaluation ⇒ "N/O" (not observed)
export type ComparisonOutcome = "a" | "b" | "tie" | "skip" | "insufficient_observation";

export interface Person { id: string; name: string; bio?: string; affiliation?: string; status: PersonStatus; createdAt: Date; updatedAt: Date; }
export interface Referral { id: string; referrerId: string; candidateId: string; conviction: Scale5; confidence: Scale5; relationshipDepth: Scale5; evidenceType: EvidenceType; evidenceText: string; createdAt: Date; updatedAt: Date; }
export interface Evaluation { id: string; evaluatorId: string; candidateId: string; dimension: Dimension; score: RubricScore | null; confidence: Scale5 | null; evidenceText: string; createdAt: Date; updatedAt: Date; }
export interface Comparison { id: string; evaluatorId: string; personAId: string; personBId: string; dimension: Dimension; outcome: ComparisonOutcome; winnerId: string | null; confidence: Scale5 | null; evidenceText?: string; createdAt: Date; }
```
Plus placeholder interfaces (fields from `docs/theory/main.tex` §"A Minimal Application Data Model"): `Outcome`, `Opportunity`, `JudgeCalibration`, `JudgeBias`, `PredictionSnapshot`. Add a doc comment: *"Reserved for V2+; no logic reads these."*

### `src/domain/constants.ts`
- `DIMENSIONS: readonly Dimension[]` in the canonical order (problem_solving … originality).
- `EVIDENCE_MULTIPLIER: Record<EvidenceType, number>` = `{ firsthand_work: 1.0, firsthand_personal: 0.9, artifact: 0.85, reputation: 0.6, other: 0.7 }`.
- `REFERRAL_WEIGHTS = { conviction: 0.5, confidence: 0.3, relationshipDepth: 0.2 }`.
- `DIMENSION_PROMPTS: Record<Dimension, string>` — the seven pairwise prompts from the MVP prompt §14, verbatim.
- `REFERRAL_PRIMING_PROMPTS: readonly string[]` — primary + six optional prompts from §7, verbatim.
- `SCALE_LABELS` for conviction / confidence / relationshipDepth / rubric anchors (§8, §12) so a UI can render them without re-typing.
- `PRODUCT_LANGUAGE = { referralSignal: "Referral Signal", relativeCapability: "Relative Capability Estimate", insufficientEvidence: "Insufficient Evidence", … }` and `BANNED_LANGUAGE = ["Talent Score", "Intelligence Score", "Capability Score", "Objective Rank", "Human Value"]`.

### `src/domain/validate.ts`
Pure functions returning `{ ok: true } | { ok: false; errors: string[] }` (no throwing):
- `validateReferral(r, existing: Referral[])` — no self-referral; all three scales ∈ 1..5 integers; duplicate `(referrerId, candidateId)` rejected; `evidenceText` non-empty.
- `validateEvaluation(e)` — score null or 0..4 integer; confidence null or 1..5; if score is null, confidence must be null.
- `validateComparison(c, opts?: { allowSelfEvaluation?: boolean })` — `personAId !== personBId`; `winnerId` must be `personAId` when outcome `"a"`, `personBId` when `"b"`, `null` otherwise; dimension ∈ `DIMENSIONS`; evaluator may not be A or B unless `allowSelfEvaluation`.

### `src/index.ts`
Re-export everything above.

## Tests — `tests/validate.test.ts`
Cover each rule above with one passing and one failing case.

## Do not
- Put any scoring math here.
- Read `affiliation` anywhere outside display metadata.


## Update-mechanism note (see #15)
The numeric constants here are the *values* of the first `ReferralSignalSpec` version. Export them from a versioned spec object (`src/models/spec.ts`, `registry.ts`) rather than as loose constants, so weights can change under a new version without touching math code.
