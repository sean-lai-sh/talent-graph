# E1: Domain + spec for slope snapshots (`judge_reliability@3.0.0`, registered but not current)

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/20

**Phase E · wave 1 · depends on: PR #17 (V2, already on this branch)**

## Goal
Add the types and the versioned spec that later Phase E issues compute against.
Register `judge_reliability@3.0.0` in the append-only registry **without**
making it `CURRENT_SPECS.judge_reliability`. No slope math, no scout math, no
Referral Signal change.

## Why
V2 grades a judge on level only (`E_uv = (x_uv − truth_uv)²`). Phase E adds a
second, separately reported number (scout information gain) built from residual
*slope*. The numbers and the hook live on a new spec version so 2.0.0 stays
bit-identical.

## Types — append at the **bottom** of `src/domain/types.ts`
Do **not** edit the `Referral` interface (that's #21). Add:

```ts
export type ForecastKind = "unspecified" | "will_compound";

export type ResidualSlopeState =
  | "defined"
  | "insufficient_early"
  | "insufficient_late"
  | "undefined_window";

/** Snapshot of ΔR*_v = R*_v(t1) − R*_v(t0). Computed in #22; type only here. */
export interface ResidualSlope {
  personId: string;
  t0: Date;
  t1: Date;
  residualT0: number | null;
  residualT1: number | null;
  delta: number | null;
  state: ResidualSlopeState;
}

/**
 * Persistable scout number Ĝ_u. Produced in #24; type only here.
 * Never added to p̂_u. Never derived from θ.
 */
export interface ScoutInformationGain {
  judgeId: string;
  gain: number;
  evaluatedCount: number;
  rawGain: number | null;
  updatedAt: Date;
}
```

`ForecastKind` is declared here so #21 can use it; do not add it to `Referral`.

Optional persistable field on existing `JudgeCalibration` (do not rename
existing fields): `scoutGain?: number | null`.

## Spec — `src/models/spec.ts`
Keep every 2.0.0 field required. Add **optional** V3 fields so existing
`JUDGE_RELIABILITY_V2_0_0` stays a valid `JudgeReliabilitySpec` without edits:

```ts
  /** When true, Referral Signal may apply scout weights. Default / 2.0.0: absent. */
  scoutHook?: boolean;
  /** λ_g ≥ 0: shrink Ĝ_u toward 0. Absent on 2.0.0. */
  scoutShrinkage?: number;
  /** Minimum t1 − t0 in days before ΔR* is defined. Absent on 2.0.0. */
  slopeMinGapDays?: number;
```

`validateSpec` for `judge_reliability`:
- 2.0.0 (fields absent): same errors as today. Do not require V3 fields.
- If any V3 field is present: `scoutHook` must be boolean; `scoutShrinkage`
  finite ≥ 0; `slopeMinGapDays` finite ≥ 0.
- Never throw; never mutate the incoming spec.

## Registry — `src/models/registry.ts`
Append, do not edit `JUDGE_RELIABILITY_V2_0_0`:

```ts
export const JUDGE_RELIABILITY_V3_0_0: JudgeReliabilitySpec = deepFreeze({
  ...same 2.0.0 values...,
  version: "3.0.0",
  scoutHook: false,
  scoutShrinkage: 3,
  slopeMinGapDays: 90,
});
```

- `SPEC_HISTORY` appends it.
- `CURRENT_SPECS.judge_reliability` **stays** `JUDGE_RELIABILITY_V2_0_0`.
- `getSpec("judge_reliability", "3.0.0")` returns the new object.
- `specVersions("judge_reliability")` becomes `["2.0.0", "3.0.0"]`.

## CHANGELOG
`tests/invariants.test.ts` requires every registered version to appear in
`docs/models/CHANGELOG.md`. Add a short `judge_reliability@3.0.0` entry:
registered, not current; V3 fields present with `scoutHook: false`; no
production math uses them yet; drift n/a until #26. Do not mark it current.

## Files you may touch
- `src/domain/types.ts` (append only; no `Referral` field)
- `src/models/spec.ts`
- `src/models/registry.ts`
- `docs/models/CHANGELOG.md`
- `docs/issues/20-phase-e1-slope-spec.md` (this brief, if not already present)
- `tests/spec.test.ts` (extend)

## Tests
- `validateSpec(JUDGE_RELIABILITY_V2_0_0)` still `{ ok: true }`.
- `validateSpec(JUDGE_RELIABILITY_V3_0_0)` `{ ok: true }`.
- `CURRENT_SPECS.judge_reliability` is still 2.0.0 (same reference).
- `getSpec("judge_reliability", "3.0.0")` is the new frozen object.
- V3 with `scoutShrinkage: -1` or `scoutHook: "yes"` rejected.
- JSON of 2.0.0 is unchanged (no new keys on that object).
- Existing judges / scoring / seed tests still pass with no source edits.

## Do not
- Change `CURRENT_SPECS`.
- Edit `JUDGE_RELIABILITY_V2_0_0` or any other existing registry entry.
- Implement `ΔR*`, `Ĝ_u`, `forecastKind` on Referral, or `scoutHook` behaviour.
- Import `src/inference` from new types (types file imports nothing new).
- Touch `PLAN.md` / `README.md` (owned by #27 / already drafted locally).
