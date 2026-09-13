# Club verification map

This directory is the maintained source for verifying the user-facing behavior of Club (the Talent Graph council-review page). Read the index before driving the app, then use the matching feature file as the recipe.

Scoring, dashboard text, and spec drift are not this map. Use `.cursor/skills/verify-engine/`.

## Baseline preconditions

- Launch Club with `.cursor/skills/verify-club/helpers/launch.sh` so the instance is on `127.0.0.1` and a non-shared port (default `43173`).
- Run `.cursor/skills/verify-club/helpers/doctor.sh` and require the printed URL, a live launch pid, the `/` → `/example` redirect, the `/example` seed-board identity, the `/club` → `/login` redirect, and the `/login` card.
- Drive only that URL. Never attach to `http://127.0.0.1:3000` unless doctor says this run owns it.
- Viewport width ≥ 1280 so the `Applicants` region is visible.
- Start from the seed: refresh `/example` or choose `Reset to seed` after any mutation. Doctor must have already proven `GET /` redirects to `/example`.
- Do not sign in. Prove unauthenticated `/club` only as a redirect to `/login`.

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
- Record the feature ID and entry point (`/` redirect or `/example`) with every artifact.
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
- [Login door](./login-door.md) covers the centered `/login` card, the `/club` redirect, and `/example` staying public.
