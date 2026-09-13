# E4: Referral `forecastKind`, default unspecified

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/21

**Phase E · wave 1 · depends on: #2 (domain types, already shipped)**

## Goal
Referrals gain an optional `forecastKind`. Old rows stay valid. `R_uv` is
bit-for-bit unchanged. Unspecified referrals stay on the V2 intensity rule
only; they must not be silently treated as scout-eligible.

## Type — `src/domain/types.ts` only on `Referral`
```ts
export type ForecastKind = "unspecified" | "will_compound";
```
If #20 already declared `ForecastKind`, reuse it — do not duplicate.

On `Referral`, add **only**:
```ts
  /**
   * What the referrer claimed they were forecasting. Default / omitted:
   * `"unspecified"`. Only `"will_compound"` is scout-eligible (issue #24).
   * Does not enter R_uv.
   */
  forecastKind?: ForecastKind;
```

Do not add slope types (those are #20). Do not add other Referral fields.

## Validation — `src/domain/validate.ts`
- Missing / `undefined` ⇒ valid (means unspecified).
- `"unspecified"` | `"will_compound"` ⇒ valid.
- Any other string ⇒ `{ ok: false }` with a clear error.
- Existing rules unchanged (no self-referral, scales, duplicate pair, etc.).

## Scoring
`src/scoring/referralStrength.ts` and `referralSignal.ts` must not read
`forecastKind`. Add a scoring test: two referrals identical except
`forecastKind` produce the same `R_uv` and the same Referral Signal.

## Seed
`src/seed/generate.ts` may omit the field (preferred) or set `"unspecified"`.
Do **not** mark persona referrals `will_compound` yet (that's #23).

## Barrel / constants
Re-export the type via existing `export * from "./domain/types.ts"`.
Optional: `FORECAST_KINDS` next to other enums in `constants.ts`.

## Files you may touch
- `src/domain/types.ts` (`ForecastKind` + one optional field on `Referral`)
- `src/domain/validate.ts`
- `src/domain/constants.ts` (optional enum list only)
- `src/seed/generate.ts` (omit or `"unspecified"` only)
- `tests/validate.test.ts`
- `tests/scoring.test.ts`
- `docs/issues/21-phase-e4-forecast-kind.md`

## Tests
- Referral without `forecastKind` still validates.
- `"will_compound"` validates; `"already_famous"` (or any other) fails.
- `R_uv` identical with and without the field.
- Seed still generates; existing seed tests pass.

## Do not
- Change any formula, weight, or spec version.
- Implement scout eligibility or information gain.
- Edit `src/models/registry.ts` or `JUDGE_RELIABILITY_*`.
- Edit `PLAN.md` / `README.md`.
- Touch slope snapshot types at the bottom of `types.ts` if #20 added them.
