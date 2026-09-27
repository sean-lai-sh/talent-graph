# Convex + Better Auth (club door)

This folder is the official `@convex-dev/better-auth` component setup for
`/club` only. `/demo` stays on `generateSeed()` and does not use it.
`/` is the chips landing. `/example` redirects to `/demo`. Public signup is
disabled; provision owners with `auth:provisionUser` (see
`scripts/provision-user.ts`).

**Persisted:** domain inputs, one row per record. `clubs` holds the club's
name, clock `now` (wall time; not `EXAMPLE_T_*`) and review config.
`clubPeople`, `clubReferrals`, `clubComparisons`, `clubEvaluations`,
`clubOutcomes`, `clubOpportunities`, `clubSnapshots` and
`clubFeedbackRequests` each hold one engine record per row, with `clubId`
and the engine's domain `id`. `lib/clubStore.ts` is the only reader and
writer of those tables: `loadState` rebuilds the engine's `ClubState`, and
`saveState` writes back only the rows a transition changed
(`lib/clubWrites.ts`). No document grows with the club; each read is bounded
by Convex's per-transaction limits (16 MiB, 32,000 documents). Snapshot
`values.referralSignal` is accept/archive provenance only.

Anything that grows with the club gets its own table, one row per record,
never a list inside a document. `tests/club-schema-bounds.test.ts` fails on
any new list field. When Jev judgments are persisted, they follow the same
rule: a `JevJudgmentStore` (`src/longitudinal/store.ts`) backed by its own
table, read by record id, and not part of `ClubState`.

**Auth (SEA-12):** board reads and all mutations require a Better Auth
session via `authComponent.safeGetAuthUser` / `getAuthUser` and a marked
admin role (`clubAccounts.role`, else `chips@techatnyu.org` /
`CLUB_ADMIN_EMAILS`). Every admin shares one club: the oldest `clubs` row
(`lib/clubStore.ts`), created by the first admin to open `/club`.
`createdByUserId` records who created it. One club per deployment, not a
membership / invite model. Accounts that are not marked admin land on `/members`.
The member forum is `clubPosts` — any signed-in user can post.
The member directory is `listMembers` (name, LinkedIn, email).

**Before deploying SEA-56:** there is no migration; production had no club
data. On the target deployment, check each of these with
`npx convex data <table>` and clear leftover test rows first. `clubOrgs` is
gone from the schema, and the other three now require a `clubId` that old
rows lack, so the schema push fails while they hold data:
`clubOrgs`, `clubPosts`, `referralContacts`, `memberReferrals`.

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
