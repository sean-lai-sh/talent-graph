# E8: Invariants, README §8a, theory safeguards, two-number demo

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/27

**Phase E · wave 5 · depends on: #20–#26**

## Goal
Close Phase E: encode the two collapse bans, document the V3 judge model
honestly (including where it differs from the paper formula), and show both
judge numbers on the existing demo / demo UI.

## Invariants — `tests/invariants.test.ts`
1. **Slope ≠ intercept.** No file in `src/judges` adds `delta` / `gain` into
   `reliability` / `meanSquaredError` / `p̂`. Ban combining them into one
   "talent judge score". `ScoutInformationGain` and `JudgeReliabilityEstimate`
   remain separate types.
2. **Judges never graded by θ.** `src/judges` still does not import
   `src/inference`. Also grep judges for `trueTheta`, `percentile`,
   `capability`.
3. **Judges never graded by agreement** (already implied; keep).
4. **No synthesized comparisons.** `src/seed` / `src/judges` never write
   `Comparison` rows from outcomes.
5. Language: do not introduce "Talent Score" / "Scout Score" as a collapsed
   product name. Approved: **Scout Information Gain**, **Intensity
   Calibration** / **Judge Reliability**, **Residual Slope**.

## README
Add **§8a V3 judge model — intercept vs slope** (PLAN.md 11b): why V2 misses
Cleo-type scouts; the two numbers; `forecastKind`; `scoutHook` default off;
this is a V3 reading of "Reward Information Gain", not
`|R* − R̂^{-u}| × Accuracy`. Update the roadmap row if not already present.

## Theory — `docs/theory/main.tex`
In the **same PR**, add (do not pretend they were always there):
- "Residual Series and Slope" — `ΔR*_v = R*_v(t1) − R*_v(t0)`, undefined states.
- "Two Judge Numbers" — intensity `p̂_u` vs scout `Ĝ_u`, never summed.
- Update "Reward Information Gain" to state the implemented formula
  `IG_uv = (1 − π_v(t_uv)) · max(ΔR*_v, 0)` and that Accuracy is not used.
- Safeguard 13: never grade judges by θ or by agreement; never treat missing
  slope as low ability.

Refresh the committed PDF only if the existing theory CI expects it; otherwise
leave PDF refresh to that workflow.

## Demo
`bun run demo` prints both numbers for seed judges at the existing T.
`bun run demo:ui` (this branch) shows reliability **and** scout gain as
separate series — do not replace the V2 explainer, extend it. Presentation
only.

## Do not
- Collapse the two numbers in the UI.
- Change math except docs/tests/demo.
- Turn `scoutHook` on in CURRENT_SPECS.
