# Evidence snapshots

A candidate has a starting snapshot with its thin flag. Running the snapshot cron twice changes nothing.

## Sub-features

- `detect` — on only when `planSnapshot`, a `thin:` field, and `internal.evidence.daily` are in the checkout.
- `thin-start` — an empty claim list plans an `s0` row with `thin: true`.
- `idempotent-plan` — planning that row again returns null.
- `idempotent-cron` — `evidence:daily` twice leaves the snapshot table byte-for-byte the same.

## How to get to it (user POV)

- This check is the daily snapshot job. There is no member control for it.
- The run calls `planSnapshot` and then `convex run evidence:daily` twice.

## Driving it with cursor-ide-browser

Preconditions: the markers above are in this checkout. If any marker is missing, print `SKIPPED - needs #122 on main` and stop this feature.

- Run `.cursor/skills/verify-judge-weights/run.sh`.
- Read the `snapshots` line in `evidence/<run>/run.txt`.

## Gotchas

- `outputOnlyRollup` already exists on main. Do not treat that file as the snapshot feature.
- Setting an env var does not turn this on.
- A skip must not increment `passed`.
