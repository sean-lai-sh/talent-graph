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

Vercel: set **Root Directory** to `apps/club`. `next.config.ts` sets
`outputFileTracingRoot` to the repo root so `src/` is bundled.

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
