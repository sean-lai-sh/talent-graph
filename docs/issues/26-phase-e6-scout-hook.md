# E6: Scout weights into Referral Signal (`scoutHook`, 3.0.0 becomes current)

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/26

**Phase E · wave 4 · depends on: #24, #15**

## Goal
When `scoutHook` is true, the Referral Signal may apply scout weights.
Default is **off**. `judge_reliability@3.0.0` with `scoutHook: false` is
bit-for-bit V2. Then make 3.0.0 **current**. Measure drift. Changelog.

## Hook
Existing V2 contribution: `p̂_u · clip(R_uv − b̂_u, 0, 1)`.

With `scoutHook: true`, multiply by a scout factor derived from `Ĝ_u`
(recommend `clip(Ĝ_u, 0, 1)` or `n/(n+λ)`-already-shrunk gain in [0, 1];
judges with no scout evidence stay at factor 1 so unspecified graphs do not
move). Weights are **passed in** (`src/scoring` never imports `src/judges`).

```ts
computeAllReferralSignals(people, referrals, {
  ...judgeWeightOptions(calibration),
  scoutWeights: Map<judgeId, number>, // only when hook on
});
```

`scoutHook: false` or omitted scout weights ⇒ identical signals to V2.

## Registry
`CURRENT_SPECS.judge_reliability = JUDGE_RELIABILITY_V3_0_0`
(`scoutHook: false`). Update CHANGELOG: what changed, why, drift summary, PR.

## Drift
`bun run drift` on the seed: 2.0.0 vs 3.0.0 with hook off must be `stable`
(identical scores). Hook on may `review`; attach the summary.

## Tests
- Hook off / no scout map: every signal equals V2 on the seed and on fixtures.
- Hook on + scout weight 0 for a top contributor: that candidate's signal drops.
- Judge with no Ĝ keeps factor 1.
- `CURRENT_SPECS.judge_reliability.version === "3.0.0"`.
- Invariants: scoring still does not import judges.

## Do not
- Default the hook on.
- Edit 2.0.0.
- Mix Ĝ into `p̂_u` (two numbers stay two numbers; hook is a third, flagged, path).
