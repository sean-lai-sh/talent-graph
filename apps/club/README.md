# Club product — Admin / Council Review page

This is the **Admin / Council Review page** of the club product (page 3 of
the product spec; the member referral page and the candidate profile page
are later work). One Next.js app. A council opens it to list the candidates
under consideration, read one complete case, decide, and ask members for
feedback inside a 48-hour window. It works over a screen share.

- **`src/`** is the **engine**. This app imports `../../src`. Scoring lives
  there, not here. Two new engine modules power the page:
  `src/analysis/reviewQueue.ts` (categorical evidence-state buckets, no merged
  number) and `src/judges/trackRecord.ts` (a label for whose comments to weigh;
  the raw calibration weights never reach the view).
- **Three channels, never one number.** Every case shows Referral Signal,
  Relative Capability Estimate, and Structured Evidence (rubric) side by side.
  "Configurable rubric" means the council picks which dimensions a round
  requires; nothing is weighted or totalled.
- **Convex + Better Auth** is the path for `/club` on this same app. Official
  `@convex-dev/better-auth` — not Clerk, not Neon, and **not a second frontend**.
  Do not add a login wall to `/` or `/example`.
- `/` and `/example` — public example council page over the seed. No sign-in.
  Refresh restores the seed club.
- `/club` — real-organization door. Convex + Better Auth live here. Domain
  inputs (people with review status, referrals, comparisons, evaluations,
  feedback requests, round settings, snapshots) persist in Convex. Each write
  stamps the org clock with wall time and re-runs views via `lib/engine.ts` →
  `src/`. The session / org gate is on: unauthenticated visitors see the
  Better Auth sign-in UI only (not the seed board, not PersistedClub).
  Signed-in owners get the Convex-backed page when Convex env is configured.
  `/` and `/example` stay in-memory `generateSeed()` with no auth.

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
`npx convex env set`:

```sh
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://127.0.0.1:3000
```

Do not put any of these keys on the public example deploy.

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

1. **The list on load.** Candidates under consideration (new, under review,
   needs data) with a review-status badge and an evidence-state chip from
   the engine's review queue: Cleo Marsh is **Under-recognized** (with a
   single-source flag), Dev Raman is **Single source**, Ife Doyle is **No
   referrals**, Alice and Bram are **Ready to decide**. Sort by Referral
   Signal; switch the dimension column to Agency and Cleo reads 100th in a
   low-confidence pool next to a Referral Signal of **7**. People with no
   incoming referrals show **Insufficient Evidence**, not 0.
2. **Cleo's case.** The case summary is three channels side by side: Referral
   Signal **7** (one referral, calibration lowered it from 12) ┃ seven
   dimensions with pool size and confidence ┃ rubric rows (one evaluation on
   Output). Required dimensions carry a dot. **Missing evidence** names what
   the round still needs, from engine states only; **Suggested members to
   ask** lists people with evidence on her, each with a track-record badge
   (`calibrated`, `unproven`, `tends to underrate`…) and no weights anywhere.
   **Evidence by judge** groups every comment by author, calibrated judges
   first; compares without a note are tallied, not listed.
3. **Feedback loop.** Cleo has a pending request to Tomas Lindqvist (due in
   28 h), Dev's request to Kai Duval is a day overdue, Bram's was answered.
   Request feedback from a suggested member: a new pending row appears and a
   new case moves to under review. **Record a response**: the member's rubric
   evaluation lands in Structured Evidence, the request closes, and the
   missing-evidence list shrinks.
4. **Decide.** Admit / Deny / Request more data / Reopen. Each writes a
   decision-history row with the evidence at the time and changes no number.
   Admitted and denied people leave the default list filter.
5. **Present.** Hides the list and top bar for a screen share. `J` / `K`
   move between cases; `Esc` exits. Decisions stay click-only.
6. **Round settings** picks the required dimensions. **Reset to seed** puts
   the example back.

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
6. Deploy. `/` and `/example` are the public seed council page. Refresh
   restores `generateSeed()`. `/club` persists club inputs in Convex and
   computes views from `src/`. It does not wall the example.

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
