# Club product — example admin

This is the **example admin of the club product**. One Next.js app. A human
opens it to see who the network is loud about, who is quiet, and who the
compares say is strong.

- **`src/`** is the **engine**. This app imports `../../src`. Scoring lives
  there, not here.
- **Clerk and Neon come next**, on this same app. They are **not a second frontend**.
  Do not add a login wall to `/` or `/example`.
- `/` and `/example` — public example admin. No sign-in. Refresh restores
  the seed club.
- `/club` — disabled stub for a real organization later. No Clerk, no
  persistence.

```sh
bun --cwd apps/club install
bun --cwd apps/club dev          # http://127.0.0.1:3000
# or from the repo root:
bun run club:web
```

## What to look at

1. **Cleo vs Bram on load.** Cleo Marsh is selected. She is quiet (Referral
   Signal V2 **7**, one incoming). Bram Okafor is loud (V2 **62**, four
   incoming). Graph circles follow that signal. The Referral Signal list
   has Loud and Quiet, so both are on the first screen.
2. **Try one referral or one slider.** Write a referral, or drag a
   conviction / confidence slider on an existing one and let go. The club
   re-runs. **Reset to seed** puts you back.
3. **Drag T from January to Dec 31.** The clock starts on Dec 31. Drag it
   back to January: V2 equals V0 and every judge is 1. Drag it to Dec 31:
   the observation window opens and weights move.

Also on the board: Referral Signal stays next to Relative Capability
(never merged). Accept / archive records a local snapshot and does not
invent a score. Empty incoming evidence is **Insufficient Evidence**, not
a zero.

## Deploy on Vercel (one project away)

No live preview is attached to this branch. The app is configured so a
human can ship it with one Vercel project. Do not add auth env.

| Setting | Value |
|---|---|
| **Root Directory** | `apps/club` |
| **Include source files outside of the Root Directory in the Build Step** | ON (new projects often default ON; confirm) |
| **Framework Preset** | Next.js (`apps/club/vercel.json`) |
| **outputFileTracingRoot** | repo root (`apps/club/next.config.ts`) |
| **Environment variables** | none required; do not set Clerk / auth keys |

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
6. Deploy. `/` and `/example` are the public seed club. `/club` is a
   disabled stub. Refresh restores `generateSeed()`.

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
