#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { deploymentLabel, exampleLoginAccounts, scriptTargetError } from "../lib/devSeedPlan.ts";

const clubDir = join(import.meta.dir, "..");

export function readDeployment(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.CONVEX_DEPLOYMENT) return env.CONVEX_DEPLOYMENT;
  try {
    const text = readFileSync(join(clubDir, ".env.local"), "utf8");
    const line = text.split("\n").find((item) => item.startsWith("CONVEX_DEPLOYMENT="));
    if (!line) return undefined;
    return line
      .slice("CONVEX_DEPLOYMENT=".length)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

function convexRun(functionName: string, args?: unknown): unknown {
  const command = ["convex", "run", functionName];
  if (args !== undefined) command.push(JSON.stringify(args));
  const result = spawnSync("npx", command, { cwd: clubDir, encoding: "utf8" });
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stderr.write(result.stdout);
    process.exit(result.status ?? 1);
  }
  const text = (result.stdout ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    process.stdout.write(result.stdout ?? "");
    return null;
  }
}

function printReport(value: unknown): void {
  const report = value as {
    counts?: Record<string, number>;
    referrerEmails?: string[];
    adminEmail?: string;
  } | null;
  if (!report?.counts) return;
  for (const [table, count] of Object.entries(report.counts)) {
    console.log(`  ${table} ${count}`);
  }
  if (report.referrerEmails) {
    console.log("referrer logins:");
    for (const email of report.referrerEmails) console.log(`  ${email}`);
  }
  if (report.adminEmail) console.log(`admin login: ${report.adminEmail}`);
}

export async function main(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const deployment = readDeployment(env);
  const refusal = scriptTargetError(argv, deployment);
  if (refusal) {
    console.error(refusal);
    return 1;
  }
  const password = env.SEED_DEV_PASSWORD;
  const secret = env.ADMIN_PROVISION_SECRET;
  if (!password || !secret) {
    console.error("Set SEED_DEV_PASSWORD and ADMIN_PROVISION_SECRET.");
    return 1;
  }
  if (password.length < 8) {
    console.error("SEED_DEV_PASSWORD must be at least 8 characters.");
    return 1;
  }

  const reset = argv.includes("--reset");
  console.log(`seed:dev target ${deploymentLabel(deployment)}`);
  if (!reset) {
    for (const account of exampleLoginAccounts()) {
      const passwordHash = await hashPassword(password);
      convexRun("auth:provisionUser", {
        email: account.email,
        name: account.name,
        passwordHash,
        secret,
        role: account.role,
      });
    }
  }
  const result = convexRun(reset ? "devSeed:reset" : "devSeed:seed");
  printReport(result);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
