# Scaffold: bun project, TypeScript strict, Biome, CI

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/14

**Phase A · depends on: nothing**

## Goal
Bootstrap the repo as a Bun + TypeScript library. No app framework, no DB. Everything must run with `bun install && bun run typecheck && bun test`.

## Files
- `package.json` — `"name": "talent-graph"`, `"type": "module"`, `"private": true`, scripts:
  - `test`: `bun test`
  - `typecheck`: `tsc --noEmit`
  - `lint`: `biome check .`
  - `format`: `biome format --write .`
  - `demo`: `bun run scripts/demo.ts`
  - devDeps: `typescript@^5`, `@biomejs/biome`, `@types/bun`
- `tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `module: "ESNext"`, `moduleResolution: "bundler"`, `target: "ES2022"`, `types: ["bun-types"]`, `include: ["src", "tests", "scripts"]`.
- `bunfig.toml` — `[test] root = "tests"`, `coverage = false`.
- `biome.json` — recommended rules, 2-space indent, double quotes, line width 100. Disable `noNonNullAssertion` only if needed in tests.
- `src/index.ts` — empty barrel with a comment; issue #1 fills it.
- `tests/smoke.test.ts` — `expect(1+1).toBe(2)` so CI is green.
- `.github/workflows/ci.yml` — on push + PR to main: `oven-sh/setup-bun@v2`, `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun test`.
- `README.md` skeleton with headings: Product concept · V0 model · V1 model · Limitations · Roadmap · Development. Body filled in issue #12. Include the one-line rule: *this repo is the algorithm core only*.
- `.env.example` listing the six `TG_*` vars from PLAN.md §10 with defaults (values only, no secrets).

## Acceptance
- `bun install`, `bun run lint`, `bun run typecheck`, `bun test` all exit 0 locally.
- CI workflow passes on the PR.
- `bun.lock` committed.

## Do not
- Add Next.js, React, Prisma, Postgres, Docker, or any ML dependency.
- Add runtime dependencies at all; this package should have zero.


## Update-mechanism note (see #15)
Create `src/models/` and `docs/models/CHANGELOG.md` in the scaffold and add a PR-template checkbox: "Weight/model change ⇒ new spec version + CHANGELOG entry + drift report."
