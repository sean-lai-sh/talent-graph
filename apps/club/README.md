# Club product — example admin

This is the club product's Next.js app. One app, two doors:

- `/` and `/example` — public **example admin**. Unauthenticated seed club from
  `generateSeed()`. Refresh restores the seed.
- `/club` — disabled stub for a real organization later. No Clerk, no
  persistence, no login wall on the example.

The board imports the algorithm core from `../../src`. It is the example admin
surface of the product, not a side explainer.

```sh
bun --cwd apps/club install
bun --cwd apps/club dev          # http://127.0.0.1:3000
# or from the repo root:
bun run club:web
```

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

What you can do on the example:

- Read Referral Signal next to Relative Capability (never merged)
- Open a persona dossier (start with Cleo vs Bram)
- Meddle referral sliders, write a referral, run a compare
- Accept / archive — records a local snapshot, does not invent a score
- Drag evaluation time T: each tick reruns judge calibration on the *current*
  club (including slider meddles), not a pre-baked seed tape
