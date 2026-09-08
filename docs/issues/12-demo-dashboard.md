# Demo script + dashboard summaries

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/11

**Phase C · depends on: #2, #6, #8, #9**

## Goal
Make the referral-vs-capability distinction visible without a UI. `bun run demo` should print the MVP prompt §41 report for personas A–F.

## `src/analysis/dashboard.ts`
```ts
export interface DashboardSummary { people: number; candidates: number; members: number; archived: number; referrals: number; comparisons: number; evaluations: number;
  recentReferrals: Referral[] /* 10 newest */; topReferralSignal: ReferralSignalResult[] /* 10 */;
  topCapability: Array<{ personId: string; dimension: Dimension; percentile: number; comparisonCount: number }> /* 10, estimated only */;
  underRecognized: UnderRecognition[] /* 10 */; }
export function buildDashboard(data: SeedDataset | {people,referrals,evaluations,comparisons}, signals, capRun, gaps): DashboardSummary
```
Plus `personReport(personId, data, signals, capRun, gaps): string` producing exactly this shape:
```
Alice Tanaka
Referral Signal
78 / 100
3 incoming referrals · 2 firsthand · strongest 0.93
Why: [referrer → strength · conviction/confidence/depth · evidenceType]  ×≤5

Relative Capability Estimate
Problem solving      93rd percentile · 18 comparisons · 11 opponents · pool: 37 people, medium confidence
Learning velocity    88th percentile · 11 comparisons
Taste                Insufficient evidence (2 comparisons; need at least 3)
…
Interesting signal: pairwise capability estimate substantially exceeds referral recognition (gap +41 on problem_solving)   [only when gap ≥ 25]
```

## `scripts/demo.ts`
Generates seed (#9), runs signals, capability, gaps, prints dashboard summary then `personReport` for A–F. Exit 0.

## Tests — `tests/dashboard.test.ts`
- Counts match dataset; `topCapability` contains no `insufficient_evidence` entries.
- Snapshot-free assertions on `personReport`: contains "Referral Signal", "Relative Capability Estimate", never contains any `BANNED_LANGUAGE` string.
- Cleo appears in `underRecognized`; Fox's generativity line says "Insufficient evidence".
