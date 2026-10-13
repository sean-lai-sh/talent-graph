# Judge-weight verification map

Read this index, then the feature file. The live proof is `.cursor/skills/verify-judge-weights/run.sh`. Recipes below are what that run must show.

Scoring math that is not one of these four checks stays on `.cursor/skills/verify-engine/`.

## Baseline preconditions

- Launch with `.cursor/skills/verify-judge-weights/run.sh` so Convex is `http://127.0.0.1:3210` and the app is `http://127.0.0.1:43173`.
- Run `.cursor/skills/verify-judge-weights/doctor.sh` and require the printed URL.
- Drive only that URL. Never attach to `:3000`. Never run `convex deploy`.
- Sign in only as `@example.test` accounts the run created.
- Checks 2–4 print `SKIPPED - needs #<pr> on main` until their functions exist in the checkout. A skip is not a pass.

## Features

- [Admin-only weights](./admin-only-weights.md) is always on.
- [Admission credit](./admission-credit.md) waits on #120.
- [Snapshots](./snapshots.md) waits on #122.
- [Referral signal](./referral-signal.md) waits on #123.
