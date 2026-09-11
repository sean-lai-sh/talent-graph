# Club product — example admin

This is the **example admin of the club product**. One Next.js app. A human
opens it to see who the network is loud about, who is quiet, and who the
compares say is strong.

- **`src/`** is the **engine**. This app imports `../../src`. Scoring lives
  there, not here.
- **Convex + Better Auth** is the path for `/club` on this same app. Official
  `@convex-dev/better-auth` — not Clerk, not Neon, and **not a second frontend**.
  Do not add a login wall to `/` or `/example`.
- `/` and `/example` — public example admin. No sign-in. Refresh restores
  the seed club.
- `/club` — real-organization door. Convex + Better Auth live here. Domain
  inputs (people, referrals, comparisons, snapshots, clock) persist in
  Convex. Mutations re-run views via `lib/engine.ts` → `src/`. The session
  / org gate is on: unauthenticated visitors see the Better Auth sign-in
  UI only (not the seed board, not PersistedClub). Signed-in owners get
  the Convex-backed board when Convex env is configured. `/` and
  `/example` stay in-memory `generateSeed()` with no auth.

```sh
bun --cwd apps/club install
bun --cwd apps/club dev          # http://127.0.0.1:3000
# or from the repo root:
bun run club:web
```

`/` and `/example` need no Convex project. `/club` (signed-in owners only)
is wired to the Convex project `talent-graph` (dev deployment
`youthful-capybara-14`) with every env var in Doppler `talent-graph/dev`.
No `.env.local`:

```sh
doppler setup            # once per clone; reads repo-root doppler.yaml
bun run club:convex      # doppler run -- convex dev   (pushes convex/ on change)
bun run club:web         # doppler run -- next dev     (http://127.0.0.1:3000)
```

Doppler `dev` holds the Next side (`CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`,
`NEXT_PUBLIC_CONVEX_SITE_URL`, `NEXT_PUBLIC_SITE_URL`) and a mirror of the
Convex side (`BETTER_AUTH_SECRET`, `SITE_URL`), which is also set on the
deployment itself via `npx convex env set`. Rotate the secret in both places.

Production is the same shape with its own values. Doppler `talent-graph/prd`
points at the Convex **prod** deployment `polished-shrimp-424` with
`SITE_URL` / `NEXT_PUBLIC_SITE_URL` = `https://club-gold-nine.vercel.app`,
and the prod deployment carries its own `BETTER_AUTH_SECRET`. Vercel does
not read Doppler on its own: sync `prd` → the Vercel **Production**
environment (Doppler → Integrations → Vercel), or `vercel env add` the four
`NEXT_PUBLIC_*` / `CONVEX_DEPLOYMENT` keys. To have Vercel builds also push
`convex/` to prod, add a `CONVEX_DEPLOY_KEY` (Convex dashboard → Settings →
Deploy keys) and use `npx convex deploy --cmd 'next build'` as the build
command. Until then, push prod functions by hand:

```sh
bun --cwd apps/club run convex:deploy   # doppler run -- convex deploy (targets PROD)
```

Without Doppler: `npx convex dev` in `apps/club` writes `NEXT_PUBLIC_CONVEX_*`
into `.env.local`; add `NEXT_PUBLIC_SITE_URL` and set the two Convex vars with
`npx convex env set`. Do not put any of these keys on the public example deploy.

Required env for a live `/club` door (Sean):

| Where | Variable | What it is |
|---|---|---|
| Next `.env.local` (from `npx convex dev`) | `CONVEX_DEPLOYMENT` | Convex CLI deployment slug |
| Next `.env.local` | `NEXT_PUBLIC_CONVEX_URL` | `https://….convex.cloud` |
| Next `.env.local` | `NEXT_PUBLIC_CONVEX_SITE_URL` | `https://….convex.site` — not `.cloud` |
| Next `.env.local` | `NEXT_PUBLIC_SITE_URL` | Origin you open, e.g. `http://127.0.0.1:3000` |
| Convex deployment (`npx convex env set`) | `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| Convex deployment | `SITE_URL` | Same origin as `NEXT_PUBLIC_SITE_URL` |

Without those, `/club` stays on the sign-in UI plus a "Convex is not connected" warning. The seed board does not appear there. A live session / persist round-trip still needs `npx convex dev`.

## What to look at

1. **Cleo vs Bram on load.** Cleo Marsh is selected. She is quiet (Referral
   Signal V2 **7**, one incoming). Bram Okafor is loud (V2 **62**, four
   incoming). Graph circles follow that signal. The Referral Signal list
   has Loud and Quiet, so both are on the first screen. Click **Ife** or
   **Noor** in Relative Capability; the dossier Referral Signal is
   **Insufficient Evidence**, not 0. They do not appear as IE on load.
2. **Try one referral or one slider.** Write a referral, or drag a
   conviction / confidence / relationship slider on an existing one and
   let go. The club re-runs. **Reset to seed** puts you back.
3. **Drag T from January to Dec 31.** The clock starts on Dec 31. Drag it
   back to January: persona cards show V2 = V0 (or Insufficient Evidence
   if no referral exists yet at that T) and the caption reads
   `window closed · V2 = V0`. The judge list is empty. Drag it to Dec 31:
   the observation window opens and weights move.

Also on the board: Referral Signal stays next to Relative Capability
(never merged). Accept / archive records a local snapshot and does not
invent a score. Empty incoming evidence is **Insufficient Evidence**, not
a zero.

## Deploy on Vercel (one project away)

No live preview is attached to this branch. The app is configured so a
human can ship the public example with one Vercel project. Do not add
auth env for `/` or `/example`. Convex + Better Auth keys are `/club`
only.

| Setting | Value |
|---|---|
| **Root Directory** | `apps/club` |
| **Include source files outside of the Root Directory in the Build Step** | ON (new projects often default ON; confirm) |
| **Framework Preset** | Next.js (`apps/club/vercel.json`) |
| **outputFileTracingRoot** | repo root (`apps/club/next.config.ts`) |
| **Environment variables** | none required for `/` and `/example`. `/club` uses Convex + Better Auth vars from `.env.example` when a deployment is connected |

`outputFileTracingRoot` must stay the **repository root**, not `apps/club`.
The board imports `../../src`; tracing from the repo root puts that tree
in the serverless bundle. That only works when Root Directory is
`apps/club` **and** source files outside that directory are included
in the build.

### Dashboard (Git)

1. [Vercel Dashboard](https://vercel.com/dashboard) → **Add New…** → **Project**.
2. Import `sean-lai-sh/talent-graph`.
3. Next to **Root Directory**, click **Edit** and set it to `apps/club`.
   In the same Root Directory control, enable **Include source files
   outside of the Root Directory in the Build Step**. New projects often
   default this ON — confirm it is on. Later:
   **Project Settings → Build and Deployment → Root Directory**.
4. Leave Framework Preset as **Next.js**. Leave Install / Build / Output
   on the detected defaults. Do not set Output Directory.
5. Skip Environment Variables. Optional `TG_*` keys are in
   [`apps/club/.env.example`](.env.example); they are not required.
6. Deploy. `/` and `/example` are the public seed club. Refresh restores
   `generateSeed()`. `/club` persists club inputs in Convex and computes
   views from `src/`. It does not wall the example.

### CLI (from the repository root)

Vercel CLI must be invoked from the **repo root**, not from `apps/club`.
`bunx vercel link` only links the directory to a project — it has no
flag for Root Directory and does not set it. After link, set Root
Directory with `project update`. The include-files-outside-root toggle
is dashboard-only (same control as Root Directory; new projects often
default ON).

```sh
# from the talent-graph repo root
bunx vercel link
bunx vercel project update --root-directory apps/club
# Dashboard: Project Settings → Build and Deployment → Root Directory
# Enable "Include source files outside of the Root Directory in the Build Step"
bunx vercel               # preview
bunx vercel --prod        # production, when you want it
```

Local check before you deploy: `bun run club:build` from the repo root.

`AGENTS.md` and `CLAUDE.md` here are **Next.js agent-rules files** (Next
rewrites `AGENTS.md` on `next dev`). They are not product copy and are not
the old `demo/` explainer voice. Commit the generated `AGENTS.md` so the
tree stays clean.
