# Engine verification map

This directory is the maintained source for verifying the user-facing behavior of the Talent Graph engine CLI. Read the index before driving, then use the matching feature file as the recipe.

The Club web UI is not this map. Use `.cursor/skills/verify-club/`.

## Baseline preconditions

- Launch with `.cursor/skills/verify-engine/helpers/launch.sh`.
- Run `.cursor/skills/verify-engine/helpers/doctor.sh` and require package `talent-graph` and the demo/drift commands.
- Leave `TG_*` unset unless a recipe sets them and uses `KEEP_TG=1`.
- Each recipe is a fresh process on `generateSeed()`. There is no session to reset.

## Driving conventions

- Start every recipe from the baseline env unless its preconditions say otherwise.
- Treat every command as literal. Keep flags and quoted versions unchanged.
- Run demo through `helpers/demo.sh`. Run drift through `helpers/drift.sh`.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the command and the full transcript, not only a grepped line.
- CLI proof is stdout, stderr, and exit code.
- Drift that is meant to be a no-op must show `Verdict: STABLE` and τ = 1, not merely exit 0.
- Record the feature ID and argv with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify-engine` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Demo dashboard](./demo-dashboard.md) covers the opening dashboard: counts, top Referral Signal, top capability, under-recognition.
- [Demo review queue](./demo-review-queue.md) covers categorical evidence-state buckets, no merged score.
- [Demo person report](./demo-person-report.md) covers the six persona reports and Cleo's V0 **12 / 100** (Club UI 7 is V2).
- [Demo judge calibration](./demo-judge-calibration.md) covers V2 labels and the V0 → V2 Referral Signal table.
- [Demo longitudinal progress](./demo-longitudinal-progress.md) covers per-case checkpoints and reporting-only residual slopes.
- [Drift](./drift.md) covers same-spec STABLE, usage errors, and an `env` override preview.
- [Judge weights v4](./judge-weights-v4.md) covers `judge_reliability@4.0.0` through drift: v4 → v4 is STABLE across 5 reports, v2 → v2 across 3, and v2 → v4 is BREAKING with exit 1. It also checks that `demo` still shows v2 is current.
- [Config module](./config-module.md) covers `check:config`, `check:config-gen` and stale-module detection for the generated config.

## Not user-reachable yet

- **Evidence-only substance (`outputOnlyRollup`, PR #118, SEA-80).** It's merged, but no CLI or screen calls it yet. Its first user path is the club's evidence snapshots (PR #122, SEA-81), verified through verify-club. Until then, its proof is its tests (`tests/outputOnly*.test.ts`), not a demo run. Don't write a scratch script and call it a demo proof.

## Coming with open PRs (add a recipe when each merges)

- **PR #120, SEA-79: `judge_reliability@4.1.0`, admission credit.** Add `jw4.1-same` (4.1.0 → 4.1.0 is STABLE) and a 4.0.0 → 4.1.0 run, recording its verdict. Until #120 merges, `--after 4.1.0` throws from the registry.
- **PR #123, SEA-83: `referral_signal@0.2.0`, the weight-normalised signal.** Add `rs0.2-same`, plus `--kind referral_signal --before 0.1.0 --after 0.2.0` with its verdict recorded. Re-run `jw2-to-4` afterwards: the weighted-signal arm should move much less than it does today.
- **The `CURRENT_SPECS` switch to 4.x** is Sean's call. When it happens, `demo`'s V0 → V2 pins change. Update the Cleo `12 → 7` pin in [Demo judge calibration](./demo-judge-calibration.md) and in `jw-not-current` to the new values, and say why in the commit.
