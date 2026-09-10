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

## Deploy on Vercel (one command away)

No live preview is attached to this branch. The app is configured so a
human can ship it with one Vercel project. Do not add auth env.

| Setting | Value |
|---|---|
| **Root Directory** | `apps/club` |
| **Framework Preset** | Next.js (`apps/club/vercel.json`) |
| **outputFileTracingRoot** | repo root (`apps/club/next.config.ts`) |
| **Environment variables** | none required; do not set Clerk / auth keys |

`outputFileTracingRoot` must stay the **repository root**, not `apps/club`.
The board imports `../../src`; tracing from the repo root puts that tree
in the serverless bundle.

### Dashboard (Git)

1. [Vercel Dashboard](https://vercel.com/dashboard) → **Add New…** → **Project**.
2. Import `sean-lai-sh/talent-graph`.
3. Next to **Root Directory**, click **Edit** and set it to `apps/club`.
   Later: **Project Settings → Build and Deployment → Root Directory**.
4. Leave Framework Preset as **Next.js**. Leave Install / Build / Output
   on the detected defaults (`bun install`, `bun run build`, `.next`).
5. Skip Environment Variables. Optional `TG_*` keys are in
   [`.env.example`](../../.env.example); they are not required.
6. Deploy. `/` and `/example` are the public seed club. `/club` is a
   disabled stub. Refresh restores `generateSeed()`.

### CLI (from the repository root)

Vercel CLI must be invoked from the **repo root**, not from `apps/club`.
The linked project's Root Directory is still `apps/club`.

```sh
# from the talent-graph repo root
bunx vercel link          # Root Directory = apps/club; no env
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
