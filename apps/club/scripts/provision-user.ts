#!/usr/bin/env bun
/**
 * Admin-provision an owner. Public signup is disabled.
 *
 * Hashes with better-auth's hasher, then calls the secret-gated Convex
 * mutation so the raw password never crosses the wire or lands in logs.
 *
 *   OWNER_EMAIL=you@club.edu \
 *   OWNER_NAME="You" \
 *   OWNER_PASSWORD='…' \
 *   ADMIN_PROVISION_SECRET='…' \
 *   bun scripts/provision-user.ts
 *
 * Run from apps/club so `npx convex run` targets CONVEX_DEPLOYMENT.
 */
import { spawnSync } from "node:child_process";
import { hashPassword } from "better-auth/crypto";

const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const name = process.env.OWNER_NAME?.trim() || email;
const password = process.env.OWNER_PASSWORD;
const secret = process.env.ADMIN_PROVISION_SECRET;

if (!email || !password || !secret) {
  console.error("Set OWNER_EMAIL, OWNER_PASSWORD, and ADMIN_PROVISION_SECRET.");
  process.exit(1);
}

if (password.length < 8) {
  console.error("OWNER_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const payload = JSON.stringify({ email, name, passwordHash, secret });
const result = spawnSync("npx", ["convex", "run", "auth:provisionUser", payload], {
  stdio: "inherit",
  cwd: new URL("..", import.meta.url).pathname,
});
process.exit(result.status ?? 1);
