---
name: verify-club
description: Drive the Club council-review web UI (Talent Graph example admin at / and /example) in a real browser and prove user-visible behavior. Use when changing Club pages, layout, search, decide, or feedback. For scoring, specs, demo, or drift, use verify-engine.
---

# Verify Club

Club is the Admin / Council Review page in `apps/club`. A council lists candidates, opens one case, and decides. This skill drives that **web UI** the way a user does.

The algorithm core is a different surface. Do not use this skill to prove Referral Signal math, Bradley–Terry, or drift — that is [verify-engine](../verify-engine/SKILL.md) (`bun run demo`, `bun run drift`). `bun test` is unit coverage, not either skill's live proof.

Primary surface: Next.js board at `/` and `/example` (public seed, no sign-in). Out of scope here:

- `/club` — Better Auth + Convex persist. Shares the developer's Convex deployment. Do not sign in or mutate it from verification.
- Engine CLI and `src/` — verify-engine.

Write this as instructions for an agent that has never seen the app.

## Launch

Bind a **disposable** host/port. A developer instance often already owns `127.0.0.1:3000`. Never attach to that port unless `helpers/doctor.sh` says **this run** started it.

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
- Starts `next dev` under `nohup` with `NEXT_DIST_DIR=.next-verify-<port>` so the cache is **not** `apps/club/.next`. A developer session on :3000 owns that directory; sharing it deletes `.next/dev` and restarts both servers. Do not run `bun run club:web` (Doppler + :3000).
- If you are an agent whose shell runner kills the process group when a command exits, **do not treat launch.sh finishing as “server stays up.”** Keep launch as a long-lived background job, or run doctor and the drive in the same session as launch. `nohup` does not beat a SIGKILL on the group.
- Sets `WATCHPACK_POLLING=true` so a second watcher is less likely to hit EMFILE next to the developer server.
- Uses `next dev`, not `next start`: a custom `distDir` currently fails Next typed-routes typecheck on `next build`.
- Next may rewrite `apps/club/tsconfig.json` to include the verify distDir. Cleanup restores that file from git.
- Waits until `GET /` answers, records the listening pid, runs doctor.

Ready signal: `helpers/doctor.sh` exits 0 and prints `url http://127.0.0.1:<port>`. Trust doctor, not the build log.

Default URL: `http://127.0.0.1:43173`. Drive **only** that printed URL.

Teardown is `helpers/cleanup.sh` (see Cleanup). After every failed iteration, run cleanup before launching again so ports and Next children are not stranded.

## Doctor

Run this first whenever anything looks off, and before the first drive of a session:

```sh
.cursor/skills/verify-club/helpers/doctor.sh
```

Doctor is read-only. It answers: is **this** instance worth driving?

It requires a `runs/current` file from launch, then checks:

1. The recorded launch pid is alive.
2. The recorded port is listened to by that pid or a child (Next spawns a node child). A foreign pid fails — do not drive someone else's server.
3. `GET <url>/` is HTTP 200 and the body identifies the public seed board (`Talent Graph` plus `Tech@NYU` or `Cleo Marsh`).

If doctor fails, stop. Cleanup, relaunch, doctor again. Do not fall back to `:3000` or a preview URL.

## Drive

No Playwright or Cypress in this repo. Prefer the **cursor-ide-browser** tools (navigate, lock, snapshot, click/type by role and accessible name, screenshot). Do not use coordinates.

If cursor-ide-browser cannot load `127.0.0.1` (chrome-error / MCP missing), use the local Chrome CDP helper — same user path, host-side browser:

```sh
bun .cursor/skills/verify-club/helpers/chrome-drive.ts goto http://127.0.0.1:43173/
bun .cursor/skills/verify-club/helpers/chrome-drive.ts screenshot evidence/<run>/review-board/01-home.png
bun .cursor/skills/verify-club/helpers/chrome-drive.ts click-name "Cleo Marsh"
bun .cursor/skills/verify-club/helpers/chrome-drive.ts text evidence/<run>/review-board/02-cleo.txt
bun .cursor/skills/verify-club/helpers/chrome-drive.ts screenshot evidence/<run>/review-board/02-cleo.png
```

Cleanup kills the Chrome pid recorded in `runs/<id>/chrome.json`.

Viewport: **width ≥ 1280**. Below the `lg` breakpoint the Applicants aside is `hidden` and the case shows `← All candidates`. Desktop is the default proof surface; if you must use a narrow viewport, open the list with the button named `Open applicant list` first.

Identity handles (stable; prefer these over CSS or DOM position):

| Handle | Role / name | Where |
|---|---|---|
| Brand | text `Tech@NYU` | top bar |
| Applicants | region `Applicants` | left aside |
| Search | searchbox `Search applicants` | Applicants |
| Open list | button `Open applicant list` | top bar (narrow) |
| Previous / Next | buttons `Previous applicant` / `Next applicant` | top bar |
| Account | button `Account` | top bar; opens a `menu` |
| Menu items | `Add a person`, `Round settings`, `Reset to seed` | Account menu |
| Case title | heading level 1, person name | case |
| Admit / Deny / Reopen | buttons with those names | case, when available |
| Ask | button `Ask someone` (`+` in Referrals) | case |
| Ask sheet | dialog `Ask someone` | sheet |
| Comparisons sheet | dialog `Comparisons` | sheet |
| Close sheet | button `Close` | sheet |

Keyboard (focus outside inputs): `J` / `ArrowDown` / `ArrowRight` next case; `K` / `ArrowUp` / `ArrowLeft` previous. Do not use these as the primary proof path when a named control exists.

Routes:

- `GET /` and `GET /example` — same public seed board. Either is a valid entry. Refresh restores `generateSeed()`.
- `GET /club` — sign-in door only unless you have an isolated Convex. Out of scope. If you land there by mistake, go back to `/`.

Seed pins you can assert without calling engine internals (from `loadClub()` / `tests/club-engine.test.ts`):

- `Cleo Marsh` — Referral Signal **7**, status `Under review`, bucket flags include `Under-recognized`, one referrer `Rafael de Vries`, pending request.
- `Bram Okafor` — Referral Signal **62**, responded feedback.
- `Dev Raman` — `Needs data`, overdue request with a `Record` control.
- `Ife Doyle` — no incoming referrals; signal is **Insufficient Evidence**, never `0`.
- `Alice Tanaka` — status `New`.
- `Noor Petrov` — `Admitted` (Decided group).
- Required dimensions on the example round: Problem solving, Agency, Output.

Mutations on `/` live in React state plus server actions that carry state in the request. They do not write Convex. After a mutation, prove the new UI state, then `Reset to seed` from Account so the next recipe starts clean. Refresh also restores the seed.

Recipe files live in `features/`. Read `features/README.md` before driving. A proof that uses one convenient entry point is incomplete when the map lists others — report those as untried, not verified.

## Evidence

Put every artifact under the directory doctor printed (`evidence/<run-id>/`). Launch creates that directory. Cleanup must not delete it.

```
.cursor/skills/verify-club/evidence/<run-id>/
  <feature-id>/
    01-before.aria.txt      # browser snapshot (accessibility tree)
    01-before.png
    02-after-action.aria.txt
    02-after-action.png
    notes.md                # feature id, entry point, URL, what changed
```

Proof standards:

- Exercise the real user path in the browser. Do not call `apps/club/app/actions.ts` or `lib/engine.ts` and call that a UI proof. Those are implementation. `bun test` already covers them.
- Capture the action **and** the resulting state, not only the final screen.
- UI proof is an accessibility snapshot plus a screenshot that shows Club identity (`Tech@NYU` or the case heading).
- Side effects on the example board are in-session only. Prove them by a second user-facing view (list group, status kicker, search miss) — not by reading memory. After `Reset to seed`, prove the seed names and Cleo's signal **7** returned.
- Do not mock the engine. The board already calls `src/` in-process.
- `/club` persist is a production boundary (Convex). Do not drive it on the shared deployment. A dry-run name is not isolation.
- Record the feature id and entry point (`/` vs `/example`, which control) with every artifact.
- An unreachable path is reported with the attempt and the unmet precondition. Do not mark it verified via a different path.

## Cleanup

```sh
.cursor/skills/verify-club/helpers/cleanup.sh
```

Kills the process tree recorded at launch (bun + Next child). Never `pkill -f next`, `killall node`, or any kill-by-name. If the listener on the recorded port is not in that tree, cleanup leaves it alone.

Removes `runs/current` and the run metadata directory. Copies the server log into the evidence directory, then deletes the run dir.

Does **not** delete `evidence/<run-id>/`. After cleanup, that path must still exist.

## Helpers

All scripts are executable. Run them from any cwd; they resolve the repo root themselves.

| Script | Purpose |
|---|---|
| `helpers/launch.sh` | Install if needed, start isolated Next, doctor, print URL |
| `helpers/doctor.sh` | Read-only health + identity of the current run |
| `helpers/cleanup.sh` | Kill what launch started; keep evidence |

Shared functions live in `helpers/lib.sh` (sourced, not invoked).

## Isolation rules

- Default port **43173**, host **127.0.0.1**. Two verification instances need two ports (`VERIFY_CLUB_PORT`) and get two dist dirs (`.next-verify-<port>`).
- Example board state is in-memory per server process. Instances do not share candidate data.
- Do not run `next dev` for this skill. It watches the repo root and collides with a developer session.
- Refuse to drive a server you did not launch. Doctor enforces this.
- Never drive `/club` against the shared Convex project `talent-graph` (dev `youthful-capybara-14`). That is the developer's org data.
- Present mode exists in `ClubBoard` (`data-present`) but has **no control that turns it on**. Do not invent a Present button.
