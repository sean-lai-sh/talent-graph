# Referral percentile + under-recognition gap (exploratory diagnostic)

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/8

**Phase C · depends on: #2, #6**

## Goal
The one place Referral Signal and capability meet. Explicitly exploratory. Missing evidence must never read as low.

## Files
### `src/scoring/referralPercentile.ts`
```ts
export function referralPercentiles(signals: Map<string, ReferralSignalResult>): Map<string, number | null>
```
Rank `s` among people with `incomingCount ≥ 1` using the same rank→percentile rule as #6; people with zero referrals get `null`.

### `src/analysis/underRecognition.ts`
```ts
export interface UnderRecognition { personId: string; dimension: Dimension; gap: number; capabilityPercentile: number; referralPercentile: number; tag: "exploratory"; note: string }
export function underRecognitionGaps(signals, capRun: CapabilityRun, opts?: { minComparisons?: number }): UnderRecognition[]
export function mostUnderRecognized(gaps, limit = 10): UnderRecognition[]   // gap desc
export function mostOverRecognized(gaps, limit = 10): UnderRecognition[]    // gap asc
```
`U_ik = CapabilityPercentile_ik − ReferralPercentile_i`, computed **only** when the dimension estimate is `estimated` and referralPercentile is non-null. `note` = "Exploratory diagnostic: positive values mean comparative capability exceeds network recognition. Not a production truth."

## Tests — `tests/underRecognition.test.ts`
- Candidate-C shape (low referral pct, high cap pct) ⇒ large positive gap.
- Candidate-B shape ⇒ negative gap.
- Zero referrals ⇒ no gap entry (not a gap of +100).
- Insufficient evidence on a dimension ⇒ no gap entry for that dimension.
- This module is the only file importing from both `scoring/` and `inference/` (asserted in #12).
