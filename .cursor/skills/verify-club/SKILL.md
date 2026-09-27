---
name: verify-club
description: Drive the Club web UI in a real browser with agent-browser and prove user-visible behavior. Use when changing Club pages, layout, search, decide, feedback, or sign-in. For scoring, specs, demo, or drift, use verify-engine.
---

# Verify Club

Club is the council-review app in `apps/club`. This skill drives that web UI the way a user does, with the pinned `agent-browser` CLI.

The algorithm core is a different surface. Do not use this skill to prove Referral Signal math, Bradley–Terry, or drift — that is [verify-engine](../verify-engine/SKILL.md) (`bun run demo`, `bun run drift`). `bun test` is unit coverage, not either skill's live proof.

Public routes: `/` is the chips landing, `/demo` is the hidden seed board (no sign-in), `/example` redirects to `/demo`. Signed-in routes: `/login`, `/club` (admin council), `/members` (member portal). Signed-in proof uses only the throwaway local Convex backend this skill starts.

Write this as instructions for an agent that has never seen the app.

## Install

Cloud agents run `.cursor/environment.json`. Its `install` command, from the repo root:

1. `bun install` (the repo install, which includes the exact `agent-browser` devDependency).
2. `node_modules/.bin/agent-browser install --with-deps` (Chrome for Testing and the Linux libraries it needs).
3. A symlink of that same binary to `/usr/local/bin/agent-browser`.

The version is the exact `agent-browser` entry in the root `package.json`. Do not `npm install -g` and do not install a floating version.

`install` runs when a Cloud Agent Build is created, then the disk is snapshotted. A later agent boots from that snapshot and does not run `install` again. Recurring builds clone `main`, so a snapshot taken before this pin (or from `main` before the pin is merged) has no `agent-browser`. `start` runs on every boot and repeats those three steps only when `agent-browser --version` fails, so the next boot still gets the pinned CLI.

On a machine that is not a cloud agent, from the repo root:

```sh
bun install
DEBIAN_FRONTEND=noninteractive node_modules/.bin/agent-browser install --with-deps
```

`agent-browser --version` must print the pinned version before a walk.

## Launch

Bind a disposable host and port. A developer instance often already owns `127.0.0.1:3000`. Never attach to that port.

```sh
# from the repository root
.cursor/skills/verify-club/helpers/launch.sh
```

Override only when 43173 is taken:

```sh
VERIFY_CLUB_PORT=43174 .cursor/skills/verify-club/helpers/launch.sh
```

What launch does:

- `bun install` at the repo root and `(cd apps/club && bun install)` if `node_modules` is missing.
- Starts a throwaway anonymous Convex backend on `127.0.0.1:3210` / `3211` (`CONVEX_AGENT_MODE=anonymous`). It does not log in to Convex and does not use a cloud deployment. See Local Convex.
- Starts `next dev` under `setsid` with `NEXT_DIST_DIR=.next-verify-<port>` so the cache is not `apps/club/.next`. A developer session on :3000 owns that directory. Do not run `bun run club:web` (Doppler + :3000).
- `nohup` is not enough. Bun resets `SIGHUP`, so when the launcher's process group is torn down (a tmux pane that exits), Next and Convex die. `setsid` puts them in a new session. Doctor still has to see the recorded pid alive after launch.sh has exited.
- Sets `WATCHPACK_POLLING=true` so a second watcher is less likely to hit EMFILE next to a developer server.
- Points Next at the local backend: `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210`, `NEXT_PUBLIC_CONVEX_SITE_URL=http://verify-club.convex.site`, `NEXT_PUBLIC_SITE_URL` equal to the printed origin.
- Unsets `TG_*` so Club seed pins stay stable.
- Next may rewrite `apps/club/tsconfig.json` to include the verify distDir. Cleanup restores the snapshot taken at launch (never `git checkout`).
- Waits until `GET /demo` answers, records the listening pid, runs doctor.

Ready signal: `helpers/doctor.sh` exits 0 and prints `url http://127.0.0.1:<port>`. Trust doctor, not the build log.

Default URL: `http://127.0.0.1:43173`. Drive only that printed URL.

Teardown is `helpers/cleanup.sh`. After every failed iteration, run cleanup before launching again.

## Local Convex

`convexConfigured()` is true only when `NEXT_PUBLIC_CONVEX_SITE_URL` ends with `.convex.site`, so a URL with a port does not count. Launch therefore:

- Runs anonymous `convex dev` (deployment `anonymous-agent` only).
- Adds `127.0.0.1` and `::1` hosts entries for `verify-club.convex.site`.
- Proxies port 80 on both loopback addresses to `127.0.0.1:3211` (`helpers/site-proxy.py`).
- Sets Better Auth `SITE_URL` on that deployment to this run's origin (the 43173 URL, not `:3000`).
- Provisions `admin@example.com` (admin) and `member@example.com` (member). Passwords are in `runs/<run-id>/local.env` (mode 600). Do not copy that file into evidence, the PR, or a commit.

If `apps/club/.env.local` already points at Convex cloud, or at any deployment other than `anonymous:anonymous-agent`, launch refuses and does not modify it. Cleanup restores the `.env.local` snapshot from launch, removes the hosts lines, and stops the proxy and backend. Do not commit `.env.local` or `runs/<id>/local.env`.

Never sign in to Sean's shared Convex dev deployment and never write to it. Synthetic `@example.com` users only. Any other email is a mistake; stop.

## Doctor

Run this first whenever anything looks off, and before the first drive of a session:

```sh
.cursor/skills/verify-club/helpers/doctor.sh
```

Doctor is read-only. It answers: is this instance worth driving?

It requires a `runs/current` file from launch, then checks:

1. The recorded launch pid is alive.
2. The recorded port is listened to by that pid or a child. A foreign pid fails. Do not drive someone else's server. Port 3000 fails.
3. `GET /` is the chips landing with an underlined `info` link. `GET /info` has login, contact, program copy, home, and `chips@techatnyu.org`. `GET /example` redirects to `/demo`. `GET /demo` is the public seed board. `GET /club` redirects to `/login`. `GET /login` is the sign-in form (no Create account).
4. The Convex instance name is `anonymous-agent`. Next's environment uses `http://127.0.0.1:3210` and `http://verify-club.convex.site`. Nothing in that environment or `.env.local` contains `convex.cloud`.
5. `verify-club.convex.site` resolves only to loopback, and both IPv4 and IPv6 on port 80 match the direct site port.

If doctor fails, stop. Cleanup, relaunch, doctor again. Do not fall back to `:3000` or a preview URL.

## Drive

The browser driver is `agent-browser`. Do not use cursor-ide-browser, Playwright, Cypress, or Chrome over CDP.

The walk runs in the foreground. Run each command, read its output, then run the next. Do not background a walk (`&`, `nohup`, tmux, or a second agent). A stray background walk writes extra records. End every walk with `agent-browser --session verify-club close`.

Session name is `verify-club` on every command. Viewport width is at least 1280 before the first page you judge.

```sh
URL=http://127.0.0.1:43173   # the URL doctor printed
AB=(agent-browser --session verify-club)

"${AB[@]}" open
"${AB[@]}" set viewport 1280 800
"${AB[@]}" open "$URL/login"
"${AB[@]}" snapshot
"${AB[@]}" snapshot -i
"${AB[@]}" fill @eN 'admin@example.com'
"${AB[@]}" fill @eN "$ADMIN_PASSWORD"
"${AB[@]}" click @eN
"${AB[@]}" screenshot evidence/<run>/signed-in/01-admin-club.png
"${AB[@]}" close
```

Rules for those commands:

- `snapshot` prints the accessibility tree with `@eN` refs. That file is the UI proof. `snapshot -i` is the interactive subset. Save stdout to `NN-name.snapshot.txt`.
- `click` and `fill` take a ref from the snapshot you just took. Refs go stale after navigation. Snapshot again.
- `fill` clears the field and types. Quote values. Read passwords from `runs/<run-id>/local.env`. Do not write them into snapshots, notes, or the PR.
- `screenshot <path>` writes a PNG. The first positional argument is a selector, so the path must be absolute or start with `./`. A bare relative path is treated as a selector and the PNG is not written where you asked. Club identity (`Tech@NYU`, `Council`, `Forum`, or the case heading) must be visible.
- `get url` confirms the address after a redirect.
- `wait --text "..."` waits until copy is on the page. Use it after Sign in, before the next snapshot. `Council` matches the Admin nav while the board still says `Loading club from Convex…`. Snapshot again until that line is gone.

Below the `lg` breakpoint the Applicants aside is hidden. Desktop is the default proof surface.

Identity handles (stable; prefer these over CSS):

| Handle | Role / name | Where |
|---|---|---|
| Brand | text `Tech@NYU` | top bar on `/demo` |
| Applicants | region `Applicants` | council board |
| Search | searchbox `Search applicants` | Applicants |
| Sign in | heading `Sign in`, button `Sign in` | `/login` |
| Council | heading `Council`, nav `Council` | admin `/club` |
| Forum | heading `Forum`, nav `Forum` | member `/members` |
| Sign out | button `Sign out` | signed-in top bar |
| Admit / Deny / Reopen | buttons with those names | case, when available |

Keyboard (focus outside inputs): `J` / `ArrowDown` / `ArrowRight` next case; `K` / `ArrowUp` / `ArrowLeft` previous. Do not use these as the primary proof path when a named control exists.

Routes:

- `GET /` — chips landing with underlined `info`. Not the board.
- `GET /info` — login and contact above the copy; underlined `home` under it.
- `GET /demo` — hidden public seed board. Refresh restores `generateSeed()`.
- `GET /example` — redirects to `/demo`.
- `GET /login` — email/password sign-in. No create-account.
- `GET /club` — admin council when the synthetic admin is signed in. Otherwise `/login`.
- `GET /members` — member portal when the synthetic member is signed in.

Seed pins you can assert on `/demo` without calling engine internals (from `loadClub()` / `tests/club-engine.test.ts`):

- `Cleo Marsh` — Referral Signal **7**, status `Under review`, bucket flags include `Under-recognized`, one referrer `Rafael de Vries`.
- `Bram Okafor` — Referral Signal **62**.
- `Dev Raman` — `Needs data`.
- `Ife Doyle` — signal is **Insufficient Evidence**, never `0`.
- `Alice Tanaka` — status `New`.
- `Noor Petrov` — `Admitted`.
- Required dimensions on the example round: Problem solving, Agency, Output.

Mutations on `/demo` stay in that server process. They do not write Convex. After a `/demo` mutation, `Reset to seed` from Account so the next recipe starts clean.

Recipe files live in `features/`. Read `features/README.md` before driving. The signed-in proof is `features/signed-in.md`. A proof that uses one entry point is incomplete when the map lists others — report those as untried, not verified.

## Evidence

Put every artifact under the directory doctor printed (`evidence/<run-id>/`). Launch creates that directory. Cleanup must not delete it.

```
.cursor/skills/verify-club/evidence/<run-id>/
  <flow>/
    01-name.snapshot.txt
    01-name.png
    notes.md
```

`notes.md` starts with the flow id, the entry URL, and this step table:

| Step | Action | Result |
| --- | --- | --- |
| 01-name | command and what you clicked | what the snapshot showed |

Proof standards:

- Exercise the real user path in the browser. Do not call `apps/club/app/actions.ts` or `lib/engine.ts` and call that a UI proof.
- Capture the action and the resulting state, not only the final screen.
- UI proof is an `agent-browser snapshot` plus a screenshot.
- Side effects on the example board are in-session only. Prove them by a second user-facing view. After `Reset to seed`, prove the seed names and Cleo's signal **7** returned.
- Do not mock the engine. The board already calls `src/` in-process.
- Record the flow id and entry point with every artifact.
- An unreachable path is reported with the attempt and the unmet precondition. Do not mark it verified via a different path.

## Cleanup

```sh
.cursor/skills/verify-club/helpers/cleanup.sh
```

Closes the browser (`agent-browser --session verify-club close`, then the default session). Stops the local Convex backend, the port-80 proxy, and the hosts entries. Restores `.env.local` and `apps/club/tsconfig.json` from the launch snapshots.

Kills the Next process tree recorded at launch only after the live command still matches what launch wrote. Never `pkill -f next`, `killall node`, or any kill-by-name. If the listener on the recorded port is not in that tree, cleanup leaves it alone.

Removes `runs/current` and the run metadata directory, including `local.env`. Copies the server log and Convex log into the evidence directory, then deletes the run dir.

Does not delete `evidence/<run-id>/`.

## Helpers

All scripts are executable. Run them from any cwd; they resolve the repo root themselves.

| Script | Purpose |
|---|---|
| `helpers/launch.sh` | Install if needed, start local Convex and isolated Next, doctor, print URL |
| `helpers/doctor.sh` | Read-only health of this run, including the anonymous backend |
| `helpers/cleanup.sh` | Close the browser, stop Convex, keep evidence |
| `helpers/local-convex.sh` | `start` / `stop` the anonymous backend, hosts entry, and port-80 proxy |
| `helpers/site-proxy.py` | Loopback port 80 → `127.0.0.1:3211` |

Shared functions live in `helpers/lib.sh` (sourced, not invoked).

## Isolation rules

- Default port **43173**, host **127.0.0.1**. Never `:3000`.
- One foreground walk at a time, session `verify-club`, closed at the end and again by cleanup.
- Example board state on `/demo` is in-memory per server process.
- Signed-in state is the anonymous local backend only. Emails are `admin@example.com` and `member@example.com`.
- Refuse to drive a server you did not launch. Doctor enforces this.
- Never sign in or mutate a shared Convex deployment. A dry-run name is not isolation.
- Present mode exists in `ClubBoard` (`data-present`) but has no control that turns it on. Do not invent a Present button.
- Helpers need `lsof` (port owner) and, when present, `pgrep` (process tree). Doctor and cleanup fail closed if they cannot identify the listener.
