---
name: verify-engine
description: Drive the Talent Graph algorithm core the way a user does — bun run demo and bun run drift — and prove stdout. Use when changing scoring, inference, specs, seed, dashboard text, or drift. For the Club web UI, use verify-club.
---

# Verify Engine

The engine is `src/`: pure TypeScript, no UI, no database. Users touch it through two repo-root commands, not an HTTP API.

- `bun run demo` — dashboard, review queue, per-persona reports, judge calibration, V0 vs V2 Referral Signal.
- `bun run drift -- --kind … --before … --after …` — compare two spec versions on the seed and print a verdict.

Club (`apps/club`) imports this engine. Proving a number in the browser is [verify-club](../verify-club/SKILL.md). Proving the same number from `demo` is this skill. Do not substitute `bun test` for either: tests are not the user path.

There is no long-lived backend process and no Convex in this surface. Each drive is a fresh process on `generateSeed()`.

Write this as instructions for an agent that has never seen the app.

## Launch

Launch means install once, then open a run directory. Nothing stays listening.

```sh
# from the repository root
.cursor/skills/verify-engine/helpers/launch.sh
```

What launch does:

- `bun install` at the repo root if `node_modules` is missing.
- Creates `runs/<run-id>/` and `evidence/<run-id>/`.
- Runs doctor.

Ready signal: `helpers/doctor.sh` exits 0 and prints `demo bun run demo`. There is no port.

After every failed iteration, run cleanup before launch so a stale `runs/current` is not reused.

## Doctor

```sh
.cursor/skills/verify-engine/helpers/doctor.sh
```

Read-only. It answers: is **this checkout** worth driving?

1. A current run exists (`runs/current`).
2. `bun` is on `PATH`.
3. `package.json` `name` is `talent-graph`.
4. `scripts/demo.ts` and `scripts/drift.ts` exist.
5. `node_modules` is present.
6. `generateSeed()` loads (not a feature proof).

Warns if `TG_*` is set in the shell. Baseline recipes unset those keys. A dirty env tags spec versions `+env` and will not match registered pins.

If doctor fails, stop. Cleanup, relaunch, doctor again.

## Drive

No server. Each recipe starts a new process via the helpers (they record cwd, argv, stdout, stderr, exit code):

```sh
.cursor/skills/verify-engine/helpers/demo.sh <feature-id>
.cursor/skills/verify-engine/helpers/drift.sh <feature-id> -- --kind referral_signal --before 0.1.0 --after 0.1.0
```

User-facing commands those helpers wrap (run from the repo root):

```sh
bun run demo
bun run drift -- --kind referral_signal --before 0.1.0 --after 0.1.0
bun run drift -- --kind bradley_terry --before 1.0.0 --after 1.0.0
TG_TOP_K_REFERRALS=1 bun run drift -- --kind referral_signal --before 0.1.0 --after env
```

Registered versions today: Referral Signal `0.1.0`, Bradley–Terry `1.0.0`, judge reliability `2.0.0`. `env` means the current spec with `TG_*` applied.

Literal stdout handles (assert these strings, not internal fields):

| Handle | Where |
|---|---|
| `Talent Graph — dashboard` | demo, first line |
| `Top Referral Signal:` | demo dashboard |
| `Top Relative Capability Estimates:` | demo dashboard |
| `Under-Recognition Gap (Exploratory):` | demo dashboard |
| `Review queue (candidates, by evidence state):` | demo |
| bucket labels `Under-recognized`, `Ready to decide`, `Single source`, `Referred, not compared`, `Needs more compares`, `No referrals`, `No evidence` | demo queue |
| persona names `Cleo Marsh`, `Alice Tanaka`, `Bram Okafor`, `Dev Raman`, `Ember Liu`, `Fox Delacroix` | demo reports |
| `Referral Signal` then `12 / 100` on Cleo's **person report** (V0) | demo; Club's UI 7 is V2 — see the V0→V2 table |
| `Relative Capability Estimate` | each person report |
| `Insufficient Evidence` | person report / people with no value |
| `Structured Evidence (rubric, feeds no score)` | after a persona that has rubric rows |
| `Judge calibration at T = 2026-12-31 (V2, Exploratory)` | demo tail |
| `Referral Signal, V0 (all judges = 1) vs V2 (judge-weighted):` | demo tail |
| `Cleo Marsh` V0→V2 line with `12`, `7`, and `-5` | demo tail (seed pin; Club UI shows 7) |
| `Drift report — referral_signal` | drift stdout |
| `Verdict: STABLE` | identical specs on the seed |
| usage on stderr, exit `2` | drift missing flags |

`helpers/demo.sh` and `helpers/drift.sh` **unset** `TG_*` unless `KEEP_TG=1`. For `--after env`, set the override and `KEEP_TG=1`.

Recipe files live in `features/`. Read `features/README.md` before driving. A proof that uses one convenient entry point is incomplete when the map lists others — report those as untried, not verified.

Do not import `src/` from a scratch script and call that a demo proof. The user command is `bun run demo` / `bun run drift`.

## Evidence

Put every artifact under the directory doctor printed (`evidence/<run-id>/`). Cleanup must not delete it.

```
.cursor/skills/verify-engine/evidence/<run-id>/
  <feature-id>/
    stdout.txt
    stderr.txt
    exit_code
    meta.txt          # cwd, argv, timestamps
    notes.md          # feature id, entry point, what matched
```

Proof standards:

- Exercise the real CLI. Do not call `computeAllReferralSignals` from a one-off file and call it demo.
- Capture the command **and** the resulting stdout (and stderr / exit code), not only a grepped fragment.
- Side effects: demo and drift are read-only on the filesystem and the network. Prove that by observing no new git changes and no unexpected files under the repo after the command (other than this evidence tree). Drift **prints** a CHANGELOG-shaped verdict; it must **not** write `docs/models/CHANGELOG.md`. Check `git status` after drift.
- Mocks: none. The seed is in-process.
- Record the feature id and the exact argv with every artifact.
- An unreachable path is reported with the attempted command and the unmet precondition.

## Cleanup

```sh
.cursor/skills/verify-engine/helpers/cleanup.sh
```

There is no process tree to kill unless a drive is still running — wait for it. Cleanup removes `runs/current` and `runs/<run-id>/`. It does **not** delete `evidence/<run-id>/`. After cleanup, that path must still exist.

Never `pkill -f bun` or kill-by-name. A hung drive you started may be killed by its recorded pid from the foreground job only.

## Helpers

All scripts are executable. Run them from any cwd; they resolve the repo root themselves.

| Script | Purpose |
|---|---|
| `helpers/launch.sh` | Install if needed, open a run, doctor |
| `helpers/doctor.sh` | Read-only toolchain + checkout identity |
| `helpers/demo.sh <feature-id>` | `bun run demo` → evidence |
| `helpers/drift.sh <id> -- <flags>` | `bun run drift -- <flags>` → evidence |
| `helpers/cleanup.sh` | Drop run metadata; keep evidence |

Shared functions live in `helpers/lib.sh` (sourced, not invoked).

## Isolation rules

- Each command is its own process. Two agents can run demo side by side; they do not share state.
- Baseline recipes must see an unset `TG_*`. The helpers unset them unless `KEEP_TG=1`.
- Do not point this skill at Club's Next server or Convex. Those are verify-club / out of scope.
- `bun test` is not a drive. Use it only as a doctor-style hint that the checkout compiles, never as proof of demo or drift.
