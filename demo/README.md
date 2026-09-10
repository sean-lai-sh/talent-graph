# Owner demo

Minimal Next.js board for a **hypothetical** member club. It imports the
algorithm core from `../src`. No auth, no database. Refresh restores
`generateSeed()`.

```sh
bun --cwd demo install
bun --cwd demo dev          # http://127.0.0.1:3000
# or from the repo root:
bun run demo:web
```

Vercel: set **Root Directory** to `demo`. `next.config.ts` sets
`outputFileTracingRoot` to the repo root so `src/` is bundled.

What you can do:

- Read Referral Signal next to Relative Capability (never merged)
- Open a persona dossier (start with Cleo vs Bram)
- Meddle referral sliders, write a referral, run a compare
- Accept / archive — records a local snapshot, does not invent a score

`club/` (Clerk + persistence) is a later app. Do not put auth in this folder.
