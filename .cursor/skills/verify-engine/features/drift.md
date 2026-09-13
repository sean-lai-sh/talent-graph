# Drift

`bun run drift` compares two spec versions on the same seed and prints a drift report plus a verdict (`STABLE`, `REVIEW`, or `BREAKING`). Identical registered versions must be stable. A missing flag is a usage error, not a report. The `env` after-version previews `TG_*` overrides; it still runs the real seed — observe the printed verdict rather than trusting the word preview.

## Sub-features

- `drift-usage` exits `2` and prints usage when `--before` / `--after` are missing.
- `drift-referral-same` compares Referral Signal `0.1.0` → `0.1.0` and prints `Verdict: STABLE`.
- `drift-bt-same` compares Bradley–Terry `1.0.0` → `1.0.0` and prints `STABLE` per dimension plus an overall verdict.
- `drift-env` with `TG_TOP_K_REFERRALS=1` and `--after env` prints a real report (verdict and shifts observed, not assumed).

## How to get to it (user POV)

- `bun run drift` with no flags (usage).
- `bun run drift -- --kind referral_signal --before 0.1.0 --after 0.1.0`.
- `bun run drift -- --kind bradley_terry --before 1.0.0 --after 1.0.0`.
- `TG_TOP_K_REFERRALS=1 bun run drift -- --kind referral_signal --before 0.1.0 --after env`.

## Driving it with verify-engine

Preconditions:

- Doctor is clean.

- **Usage.** `bun run drift` from the repo root (no helper required). Exit code `2`. stderr contains `usage:` and `known versions`. No `Drift report` on stdout.
- **Same Referral Signal spec.** `.cursor/skills/verify-engine/helpers/drift.sh drift-referral-same -- --kind referral_signal --before 0.1.0 --after 0.1.0`. Exit `0`. stdout contains `Drift report — referral_signal`, `Verdict: STABLE`, `Kendall τ_b 1.000`, `Top-10 Jaccard 1.00`, and `Crossed insufficiency` with `gained 0` and `lost 0`.
- **Same Bradley–Terry spec.** `.cursor/skills/verify-engine/helpers/drift.sh drift-bt-same -- --kind bradley_terry --before 1.0.0 --after 1.0.0`. Exit `0`. stdout contains `Drift report — bradley_terry ·` for dimensions and `Overall verdict across dimensions: STABLE`.
- **Env override (observe, do not assume).** `KEEP_TG=1 TG_TOP_K_REFERRALS=1 .cursor/skills/verify-engine/helpers/drift.sh drift-env -- --kind referral_signal --before 0.1.0 --after env`. Exit `0`. stdout is a `Drift report — referral_signal` whose after-label is not the bare `0.1.0` (expect `0.1.0+env` or similar). Record the printed `Verdict:` and whether `Largest movers` appears. Do not claim STABLE without reading it. Confirm the command did not write `docs/models/CHANGELOG.md` (`git status`).
- **Proof.** Keep each feature-id directory's stdout/stderr/exit_code. Quote verdict lines in `notes.md`.

## Gotchas

- `bun run drift -- --kind …` — the extra `--` is required so bun forwards flags.
- `--after env` without a `TG_*` change is another same-spec run. The interesting env path sets an override.
- Drift prints a CHANGELOG-shaped verdict; it does not write the changelog. If that file is dirty after the command, treat it as a regression.
- Unknown `--after 9.9.9` throws from the registry. That is not the usage path (usage is missing flags, exit 2).
- Helpers unset `TG_*` unless `KEEP_TG=1`. The env recipe must set `KEEP_TG=1`.
