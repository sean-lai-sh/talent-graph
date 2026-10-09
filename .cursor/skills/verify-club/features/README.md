# Club verification map

This directory is the maintained source for verifying the user-facing behavior of Club (the Talent Graph council-review page). Read the index before driving the app, then use the matching feature file as the recipe.

Scoring, dashboard text, and spec drift are not this map. Use `.cursor/skills/verify-engine/`.

## Baseline preconditions

- Launch Club with `.cursor/skills/verify-club/helpers/launch.sh` so the instance is on `127.0.0.1` and a non-shared port (default `43173`).
- Run `.cursor/skills/verify-club/helpers/doctor.sh` and require the printed URL, a live launch pid, the chips landing at `/` (underlined `info`), `/info` login + contact + copy + home, the `/example` → `/demo` redirect, the `/demo` seed-board identity, the `/club` → `/login` redirect, and the `/login` sign-in form.
- Drive only that URL. Never attach to `http://127.0.0.1:3000` unless doctor says this run owns it.
- Viewport width ≥ 1280 so the `Applicants` region is visible.
- Start from the seed: refresh `/demo` or choose `Reset to seed` after any mutation. Doctor must have already proven `/demo` is the seed board.
- Do not sign in. `/club` is in scope only as a redirect to `/login`, unless the run is local-backend mode (`features/dev-seed.md`).

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over CSS selectors or DOM position.
- Treat every command as literal. Keep quoted names unchanged.
- Run browser actions through cursor-ide-browser against the doctor URL.
- After a mutation, restore the seed. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an accessibility snapshot and a screenshot with Club identity visible (`Tech@NYU` or the case heading).
- Mutation proof includes a second user-facing view of the change (list group, status kicker, search).
- Record the feature ID and entry point (`/demo` or `/example` redirect) with every artifact.
- Report an unreachable path with the attempted control and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with cursor-ide-browser` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Review board](./review-board.md) covers loading the public seed, the applicant list, opening a case, and the three separate channels.
- [Search applicants](./search-applicants.md) covers name search, empty results, and clearing the query.
- [Decide a case](./decide.md) covers Admit, Deny, the Decided group, and Reopen.
- [Request feedback](./request-feedback.md) covers asking a member and seeing the pending request.
- [Account menu](./account-menu.md) covers Add a person, Round settings, and Reset to seed.
- [Login door](./login-door.md) covers the chips `/login` form, the `/club` redirect, `/info` login, and that `/` and `/demo` stay public.
- [Comparisons](./comparisons.md) covers the per-trait record sheet on a case.
- [Info](./info.md) covers the underlined `info` on `/` and the `/info` note.
- [Dev seed local backend](./dev-seed.md) covers signing in as an `@example.test` account against a local Convex backend seeded with `bun run seed:dev`. The seed creates member referrers only. `helpers/provision-local-admin.sh` creates the council admin after the loopback check. Doctor refuses this mode when the Convex URL is not local.
- [Evidence snapshots](./evidence-snapshots.md) covers resume intake, Jev 1.2 records, the `s0` cron, rerun idempotency, and correction rows for late evidence, against a local backend only.
- [Referral ladder](./referral-ladder.md) covers Q1–Q3 and the Ladder comparison step on `/demo/home` and on the signed-in member flow.
