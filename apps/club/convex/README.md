# Convex + Better Auth (club door)

This folder is the official `@convex-dev/better-auth` component setup for
`/club` only. `/` and `/example` stay on `generateSeed()` and do not use it.

**Persisted:** `clubOrgs` domain inputs — people, referrals, comparisons,
evaluations, outcomes, opportunities, snapshots, and clock `now` (wall
time for new orgs; not `EXAMPLE_T_*`). Snapshot `values.referralSignal`
is accept/archive provenance only.

**Auth (SEA-12):** board reads and all mutations require a Better Auth
session via `authComponent.safeGetAuthUser` / `getAuthUser`. Each
signed-in owner gets a `clubOrgs` row keyed by `ownerUserId` (index
`by_owner`). Owner-keyed club, not a membership / invite model.

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
deployment, `/club` compiles and shows the sign-in UI; it does not
open the seed board.
