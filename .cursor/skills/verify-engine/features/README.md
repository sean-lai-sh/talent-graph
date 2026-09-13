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
- [Drift](./drift.md) covers same-spec STABLE, usage errors, and an `env` override preview.
