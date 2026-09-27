# Convex + Better Auth (club door)

This folder is the official `@convex-dev/better-auth` component setup for
`/club` only. `/demo` stays on `generateSeed()` and does not use it.
`/` is the chips landing. `/example` redirects to `/demo`. Public signup is
disabled; provision owners with `auth:provisionUser` (see
`scripts/provision-user.ts`).

**Persisted:** `clubOrgs` domain inputs — people, referrals, comparisons,
evaluations, outcomes, opportunities, snapshots, and clock `now` (wall
time for new orgs; not `EXAMPLE_T_*`). Snapshot `values.referralSignal`
is accept/archive provenance only.

**Auth (SEA-12):** board reads and all mutations require a Better Auth
session via `authComponent.safeGetAuthUser` / `getAuthUser` and a marked
admin role (`clubAccounts.role`, else `chips@techatnyu.org` /
`CLUB_ADMIN_EMAILS`). Every admin shares one club: the oldest `clubOrgs`
document (`lib/theClub.ts`), created by the first admin to open `/club`.
`ownerUserId` records who created it. Later `clubOrgs` documents (one per
admin, from before SEA-55) are ignored. One club per deployment, not a
membership / invite model. Accounts that are not marked admin land on `/members`.
The member forum is `clubPosts` — any signed-in user can post.
The member directory is `listMembers` (name, LinkedIn, email).

**Before deploying SEA-55 over existing data:** run `npx convex data clubOrgs`
against the target deployment. If it lists more than one document, only the
oldest becomes the club. The people, referrals, and open feedback requests on
the others stop showing on the board, in the member directory, and in member
inboxes. They are not deleted. Merge or pick the club before you deploy.

**Computed:** every mutation and `getBoard` call `computeView` / `addPerson`
/ `setStatus` / `addReferral` / … from `lib/engine.ts`, which imports
`src/`. No scoring formulas live in Convex.

This environment may have no Convex project. Schema, mutations, queries, and
tests that compile are enough to review. A live `/club` round-trip still
needs a deployment:

```sh
npx convex dev
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://127.0.0.1:3000
```

`npx convex dev` regenerates `_generated/` and writes `NEXT_PUBLIC_CONVEX_*`
into `.env.local`. Also set `BETTER_AUTH_SECRET` and `SITE_URL` on the
Convex deployment (see `apps/club/.env.example`). Without a live
deployment, `/club` redirects to `/login`; it does not open the seed board.
