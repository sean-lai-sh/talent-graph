# Judge weights v4

`judge_reliability@4.0.0` puts every judge on the r10 weight scale: new judges start at weight `w = 0.3`, the weight stays inside (0, 1) under a soft cap, and the Referral Signal uses `ω = w²`. It is **registered but not current**. `CURRENT_SPECS.judge_reliability` is still `2.0.0`, so `bun run demo` and the Club are unchanged until Sean switches it. A user sees v4 only through `bun run drift`. The design is the Linear doc "Judge weights explained (start here)" and parent issue SEA-77.

## Sub-features

- `jw4-same` compares `4.0.0` → `4.0.0` and prints five STABLE reports: reliability, bias, weight, omega and weighted referral signals.
- `jw2-same` compares `2.0.0` → `2.0.0` and prints three STABLE reports, with no weight or omega arms because v2 has no `w`/`ω`.
- `jw2-to-4` compares `2.0.0` → `4.0.0` and prints a BREAKING overall verdict with exit code `1`. That's expected: the prior moves from 1 to 0.3 and judges with no data drop from weight 1 to 0.3 (`ω` 0.09).
- `jw-not-current` shows `bun run demo` still prints the V2 pins (Cleo `12 → 7 (-5)`), so 2.0.0 is still current.

## How to get to it (user POV)

- `bun run drift -- --kind judge_reliability --before 4.0.0 --after 4.0.0`.
- `bun run drift -- --kind judge_reliability --before 2.0.0 --after 2.0.0`.
- `bun run drift -- --kind judge_reliability --before 2.0.0 --after 4.0.0`.
- `bun run demo` (the not-current check).

## Driving it with verify-engine

Preconditions:

- Doctor is clean, and `TG_*` is unset.

- **Same v4 spec.** `.cursor/skills/verify-engine/helpers/drift.sh jw4-same -- --kind judge_reliability --before 4.0.0 --after 4.0.0`. Exit `0`. stdout has five `Drift report — judge_reliability ·` headers: `reliability`, `bias`, `weight`, `omega`, `weighted referral signals`. Each has `Verdict: STABLE`, and the last line is `Overall verdict across 5 reports: STABLE`.
- **Same v2 spec.** `.cursor/skills/verify-engine/helpers/drift.sh jw2-same -- --kind judge_reliability --before 2.0.0 --after 2.0.0`. Exit `0`. The last line is `Overall verdict across 3 reports: STABLE`, and there's no `· weight` or `· omega` header.
- **v2 → v4.** `.cursor/skills/verify-engine/helpers/drift.sh jw2-to-4 -- --kind judge_reliability --before 2.0.0 --after 4.0.0`. **Exit `1`**, because the drift gate exits 1 on BREAKING. Observed on `main` @ `9fc62c9` (seed):
  - `reliability`: `Verdict: BREAKING` (τ_b 0.578);
  - `bias`: `STABLE`;
  - `weight` and `omega`: `BREAKING` (τ_b 0.047, n=32);
  - `weighted referral signals`: `REVIEW` (τ_b 0.746);
  - last line: `Overall verdict across 5 reports: BREAKING`.

  Record the printed verdicts; don't assume them, because the numbers move when the seed or the spec moves.
- **Still not current.** `.cursor/skills/verify-engine/helpers/demo.sh jw-not-current`. Exit `0`. The V0 → V2 table still shows `Cleo Marsh          12 →   7  (-5)`. If that line changes, someone switched `CURRENT_SPECS`: stop and check with Sean.
- **No writes.** `git status` is clean after every command. Drift prints a CHANGELOG-shaped verdict but never writes `docs/models/CHANGELOG.md`.

## Gotchas

- Exit `1` on `2.0.0 → 4.0.0` is the **expected** result, not a failure of the run. Read the verdict lines.
- The v2 and v4 runs print a different number of reports (3 against 5). That's by design: under v2 the estimate has no `w`/`ω`.
- Don't prove v4 through `bun run demo` or the Club. Neither uses v4 until `CURRENT_SPECS` switches, which is Sean's call and waits on SEA-83 (the weight-normalised Referral Signal).
- Versions `4.1.0` (admission credit, PR #120) and `referral_signal@0.2.0` (PR #123) aren't on `main` yet. `--after 4.1.0` throws from the registry until #120 merges. See "Coming with open PRs" in the README.
