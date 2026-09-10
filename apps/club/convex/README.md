# Convex + Better Auth (club door)

This folder is the official `@convex-dev/better-auth` component setup for
`/club` only. `/` and `/example` stay on `generateSeed()` and do not use it.

Connect a deployment from `apps/club`:

```sh
npx convex dev
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://127.0.0.1:3000
```

`npx convex dev` regenerates `_generated/`. Persistence of club state is SEA-10.
The auth gate is SEA-12.
