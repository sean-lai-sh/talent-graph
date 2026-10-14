# Config module

Scoring hyperparameters live in `config.yml` at the repo root, which is the source of truth (SEA-51). Engine code imports a generated TypeScript module, `src/projectConfig/generated.ts`, instead of reading the YAML at import time. That's what lets the scoring code run inside Convex (PR #121). A developer changes `config.yml`, regenerates the module, and CI fails if the two drift apart.

## Sub-features

- `config-check` validates `config.yml` and prints its section hashes.
- `config-gen-check` confirms the generated module matches `config.yml`, without writing.
- `config-gen-stale` shows the check fails when `config.yml` changes without regenerating. It's a scratch edit that gets reverted.

## How to get to it (user POV)

- `bun run check:config`.
- `bun run check:config-gen`, the check-only mode CI runs.
- `bun run config:gen`, which regenerates `src/projectConfig/generated.ts`.

## Driving it with verify-engine

Preconditions:

- Doctor is clean, and the working tree is clean (`git status`).

- **Validate.** `bun run check:config`, from the repo root. Exit `0`. stdout ends with `config.yml ok` and hash lines such as `company_seed <64-hex>` and `person_rollup <64-hex>`.
- **In sync.** `bun run check:config-gen`. Exit `0`. stdout contains `src/projectConfig/generated.ts matches` and `config.yml`.
- **Stale detection.** Change a **value** in `config.yml`, e.g. `sed -i '' 's/^  wTrend: 0.2$/  wTrend: 0.21/' config.yml` (macOS sed). Then run `bun run check:config-gen`. **Expect exit `1`** and stdout containing `is out of date with` and `Run \`bun run config:gen\` and commit the result.` Then `git checkout -- config.yml`, re-run, and expect exit `0` again. Record both runs.
- **No stray writes.** After the stale-detection run and the revert, `git status` is clean. The check mode must not rewrite `generated.ts`.

## Gotchas

- **A comment-only edit doesn't trip the check.** The module is generated from parsed values, so adding a YAML comment still passes (verified). Use a value change to prove staleness.
- `bun run config:gen` **writes** `src/projectConfig/generated.ts`. Don't run it during a check-only proof; use `check:config-gen`.
- Always revert the scratch `config.yml` edit before cleanup. A leftover edit changes scoring hashes and breaks golden tests.
- These are developer commands, not end-user screens. They're the user path for "is the scoring config consistent", and the CI gate.
