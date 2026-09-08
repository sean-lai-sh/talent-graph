# Deterministic synthetic seed dataset with personas A–F

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/9

**Phase B · depends on: #1**

## Goal
In-memory generator (no DB) that produces a realistic network for tests and the demo, with the six intentionally interesting cases from the MVP prompt §30.

## Files
### `src/seed/prng.ts` — `mulberry32(seed)` returning `() => number`, plus `pick`, `shuffle`, `int(min,max)` helpers.
### `src/seed/personas.ts` — named constants for the six personas with target shapes:
| id | name | Referral Signal | Pairwise |
|---|---|---|---|
| `p-alice` | Alice Tanaka | high (4 strong firsthand referrals) | high across ≥4 dims (wins ~85%) |
| `p-bram` | Bram Okafor | high | mediocre (wins ~50%) |
| `p-cleo` | Cleo Marsh | low (1 weak reputation referral) | very high (wins ~90%, ≥15 comps) |
| `p-dev` | Dev Raman | one 5/5/5 firsthand_work referral only | 1–2 comparisons total |
| `p-ember` | Ember Liu | 6 referrals all ~2/2/2 | ~50% |
| `p-fox` | Fox Delacroix | medium | strong problem_solving (≥10 comps, ~85%), **zero** generativity comparisons |

### `src/seed/generate.ts`
```ts
export interface SeedDataset { people: Person[]; referrals: Referral[]; evaluations: Evaluation[]; comparisons: Comparison[]; }
export function generateSeed(opts?: { seed?: number /* 42 */; people?: number /* 32 */; referrals?: number /* 50 */; comparisons?: number /* 140 */ }): SeedDataset
```
- Assign each person a hidden true θ per dimension (used only to sample comparison outcomes; never exported). Outcomes sampled by `σ(θ_i − θ_j)` so BT can recover ordering.
- ~10% of comparisons are `skip`/`insufficient_observation`, ~5% `tie`.
- Include ≥20 rubric evaluations with realistic evidence text; some `score: null` (N/O).
- ~8 members, rest candidates, 1–2 archived. Affiliations are flavour only.
- All dates deterministic from the seed (base date 2026-01-01, offsets in days).
- Referral evidence text: short, plausible, first-person observations.

## Tests — `tests/seed.test.ts`
- Same seed ⇒ deep-equal dataset; different seed ⇒ differs.
- Counts meet minimums (≥25 people, ≥40 referrals, ≥100 comparisons, all 7 dimensions present).
- Every referral/comparison passes #1 validators.
- Fox has 0 generativity comparisons; Dev has ≤2 comparisons; Cleo has ≥15.
