# Dev seed local backend

`VERIFY_CLUB_LOCAL=1` points this verification server at a local Convex backend filled by `bun run seed:dev`. Sign in only as an `@example.test` account from that seed. The public `/demo` board stays the Cleo Marsh seed. This mode never uses port 3000 and never uses a shared or production Convex deployment.

## Sub-features

- `local-doctor` refuses the mode unless both Convex URLs are `127.0.0.1` or `localhost`.
- `member-home` signs in as referrer `ada.quill@example.test` and shows the member home (Forum).
- `council-board` signs in as admin `council.clerk@example.test` and lists example applicants with a Referral Signal, including Insufficient Evidence.

## How to get to it (user POV)

- Start a local Convex backend and run `bun run seed:dev` from `apps/club` with `CLUB_DEV_SEED=1` and `SEED_DEV_PASSWORD` set in the shell.
- Launch with `VERIFY_CLUB_LOCAL=1`, `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` on that local backend.
- Open `/login`, sign in as the example referrer, and land on `/members`.
- Sign out, sign in as the example admin, and open `/club`.

## Driving it with cursor-ide-browser

Preconditions:

- Doctor reports a healthy instance and prints `local-backend mode`.
- The Convex URL in that line is `127.0.0.1` or `localhost`. A cloud host is a failed run, not a fallback.
- Viewport width ≥ 1280.
- The password is the shell's `SEED_DEV_PASSWORD`. Do not write it into notes, snapshots, or the pull request.

- **Member home.** Navigate to `/login`. Fill Email `ada.quill@example.test` and Password from `SEED_DEV_PASSWORD`. Activate `Sign in`. The browser lands on `/members`. The nav is `Member`. The heading is `Forum`. Snapshot and screenshot.
- **Council board.** Activate `Sign out`. Navigate to `/login`. Fill Email `council.clerk@example.test` and the same password. Activate `Sign in`. The browser lands on `/club`. Region `Applicants` lists example names such as `Edd Pike` and `Ash Plover`. Open `Edd Pike`. The case shows a numeric Referral Signal. Open `Ash Plover`. The case shows `Insufficient Evidence`. Snapshot and screenshot the list and both cases.

## Gotchas

- Default verify-club (no `VERIFY_CLUB_LOCAL`) still must not sign in. `/club` on that launch shares whatever deployment `.env.local` names.
- Doctor fails closed when `VERIFY_CLUB_LOCAL=1` recorded a non-local Convex URL. Do not point this mode at the shared dev deployment or production.
- Example emails end in `@example.test`. Any other account is out of this recipe.
- `bun run seed:dev:reset` removes the example rows. Sign-in then fails until the next seed.
- Port 43173 only. Never attach to `:3000`.
