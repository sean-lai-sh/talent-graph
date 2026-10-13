---
name: verify-judge-weights
description: Prove judge weights stay admin-only, and run the admission, snapshot, and referral-signal checks once their code is on main. Use for SEA-77 r10 and the admin judges, cohort, and referral pages that depend on it.
---

# Verify judge weights

This skill proves the member-facing Club surfaces do not leak judge weights, then runs the three engine checks that land with later PRs. It does not change scoring, the app, or those PRs.

The always-on check is admin-only weights. The other three turn on by themselves when the merged functions and fields are in this checkout. No env var or manual flag enables them.

Write this as instructions for an agent that has never seen the app.

## Checks

1. **admin-only-weights** — always on. Must pass on main today.
2. **admission-credit** — on only when #120's code is in the tree. Otherwise print `SKIPPED admission-credit - needs #120 on main`.
3. **snapshots** — on only when #122's code is in the tree. Otherwise print `SKIPPED snapshots - needs #122 on main`.
4. **referral-signal** — on only when #123's code is in the tree. Otherwise print `SKIPPED referral-signal - needs #123 on main`.

A skipped line is not a pass. The report's `passed` count includes only `PASS` lines.

## Launch

From the repository root:

```sh
.cursor/skills/verify-judge-weights/run.sh
```

That launches when doctor is not already healthy, then runs every check.

Default backend: a throwaway local Convex at `http://127.0.0.1:3210` (site `http://127.0.0.1:3211`), started with `CONVEX_AGENT_MODE=anonymous` and `convex dev`. Default app: `http://127.0.0.1:43173` via verify-club's isolated `next dev`. Never bind `:3000`. Never run `convex deploy`.

Accounts are synthetic `@example.test` only. The member is `ada.quill@example.test`. The admin is `council.clerk@example.test`. The password stays in the gitignored run directory. Do not print it.

Opt in to the shared dev deployment only when you mean to:

```sh
VERIFY_JUDGE_WEIGHTS_SHARED=1 .cursor/skills/verify-judge-weights/run.sh
```

Shared mode runs plain `convex dev` against the checkout's dev deployment. It refuses a `prod:` deployment and refuses a loopback URL. Do not use shared mode for the SEA-95 proof run. The shared flag does not enable checks 2–4.

## Doctor

```sh
.cursor/skills/verify-judge-weights/doctor.sh
```

Doctor is read-only. It requires a current run, a live `convex dev` process whose command still matches, a loopback app URL that is not `:3000`, a non-production deployment, and a passing verify-club doctor. Local mode also requires the Convex cloud and site URLs to be loopback and `GET /instance_name` to answer.

If doctor fails, stop. Cleanup, relaunch, doctor again.

## What the run does

`helpers/run.ts` prints one report and writes the same text to `evidence/<run>/run.txt`.

Admin-only weights:

- Read every exported Convex query from `apps/club/convex/_generated/api` (the generated `api` and `internal` objects) and from each module export's Convex function metadata (`isConvexFunction` and `isQuery`). That covers nested folders under `apps/club/convex` (skip `_generated`) and custom wrappers (`customQuery`, or a local `adminQuery` / `memberQuery` that returns `query` / `internalQuery`). A text search for `query(` is not the list.
- Classify each public query as **member** or **admin**. Internal queries are listed and not called. If a public query cannot be classified, the run fails with `unclassifiable query <module:name> (...)`. There is no silent skip.
- Admin-only is explicit. Add the `module:name` ref to `helpers/admin-only-queries.ts`, or put `verify-judge-weights: admin-only` in a comment on the export. A query that returns weights (`computeView`, `judgeWeight`, or a weight key) or calls `loadOrgForSession` / `requireAdmin` / `adminRead` is admin-only only when it is listed or annotated. Otherwise it is unclassifiable. A query whose handler is visible and does neither is member-facing. `verify-judge-weights: member` is an optional confirmation and does not override a weight or admin-gate signal. An allowlist entry that is not a public query fails the run too.
- Call every classified public query as the member and as the admin. The admin call has to succeed. A member-facing query's member call has to succeed too; a thrown probe is a failure, not an empty clean payload. Admin-only queries must reject the member (throw, `null`, or an `{ ok: false }` / `{ error }` envelope). `{ ok: true }` is not a rejection. A member-facing query whose admin payload contains a weight key fails. Every member payload is scanned.
- Build the member view objects (directory, feedback inbox, referral lookup, ladder step, role, post, status) and scan them. `tests/verify-judge-weights.test.ts` also asserts the member view types have no weight keys.
- In Chrome, as the member: Forum, Member List, Submit Referral. Each step writes an accessibility snapshot and a screenshot. Then reload `/members` and capture HTTP JSON bodies and websocket frames. The capture must see at least one JSON body or frame. Scan those payloads. Do not scan JavaScript or CSS bundles.
- Sign out, sign in as the admin, open `/admin`, and screenshot it. Follow other `/admin` links on that page. On main, committee UI is not built yet (`ADMIN_HOME` is `/club`). A 404 at `/admin` is honest evidence. It does not fail the check. The payload and network scans decide pass or fail.

Weight keys, matched on keys only: exact `w` and `ω`, and case-insensitive `omega`, `weight`, `judgeWeight`, `admissionCredit`, `accuracyCredit`, `movementCredit`, `credit`, `recognition`, `recognitionAnswer`. The scan walks objects and arrays to any depth.

Admission credit, when `computeAdmission`, `decidedBy`, `signalWithoutEachReferrer`, and `admissionObservations` are all in the tree: admit a candidate decided by one of two referrers. The snapshot records `decidedBy`, a position for each referrer, and a leave-one-out signal. The deciding judge gets no admission credit.

Snapshots, when `planSnapshot`, a `thin:` field, and `internal.evidence.daily` are in the tree: the starting snapshot is thin, planning it again writes nothing, and `npx convex run evidence:daily` twice leaves the snapshot table unchanged.

Referral signal, when `REFERRAL_SIGNAL_V0_2_0`, `judgePseudoWeight`, and `pseudoWeight` are in the tree: an equal-strength referral from a new low-weight judge does not lower the candidate's signal.

## Evidence

```
.cursor/skills/verify-judge-weights/evidence/<run-id>/
  run.txt
  admin-only/member-payload-scan.json
  admin-only/browser.json
  admin-only/member/01-forum.aria.txt
  admin-only/member/01-forum.png
  admin-only/member/02-member-list.aria.txt
  admin-only/member/02-member-list.png
  admin-only/member/03-referral.aria.txt
  admin-only/member/03-referral.png
  admin-only/member/network/bodies.json
  admin-only/member/network/frames.json
  admin-only/admin/01-admin.aria.txt
  admin-only/admin/01-admin.png
```

Cleanup keeps this directory. `runs/` holds the password and is gitignored. Do not commit either tree.

## Cleanup

```sh
.cursor/skills/verify-judge-weights/helpers/cleanup.sh
```

Stops the Convex process and the Club app this run started, by recorded pid, and only when the command still matches. Restores a preexisting `apps/club/.env.local`. Leaves evidence in place.

After a successful proof, leave the servers up so a person can keep looking. Cleanup before a relaunch.

## Shared Chrome helper

PR #125 (`a0dc6ba`) changed the shared verify-club Chrome launcher at `.cursor/skills/verify-club/helpers/chrome-drive.ts`. It added `--no-sandbox` and `--disable-dev-shm-usage` next to the existing `--headless=new` flags, and it added the `links` and `capture` commands this skill uses for the member network capture and the `/admin` screenshots.

Those two flags are there because a Cloud Agent container has no Chrome user-namespace sandbox and a very small `/dev/shm`. Without them, headless Chrome exits before the DevTools port opens and the browser proof never starts. The session is still loopback-only (`127.0.0.1`). The flags apply to every verify-club Chrome launch, not only this skill, because judge-weights reuses that helper instead of starting a second browser.

## Isolation

- Reuse verify-club for the app process, doctor, Chrome session, and loopback checks. Do not copy those helpers.
- Do not edit engine code, the golden file, or PRs #120, #122, and #123.
- `bun test` may still show the two known Bradley-Terry `capability` failures in `tests/defineModelGolden.test.ts`. Do not regenerate that golden file.
