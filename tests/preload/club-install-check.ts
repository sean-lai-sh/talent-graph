/**
 * Bun test preload: abort the whole run with one clear message when the Club
 * workspace dependencies are missing.
 *
 * Several root test files import `apps/club/lib/longitudinal/*`, which pulls in
 * `@typesafe-ai/sdk`. That package only exists after `bun run club:install`, so a
 * plain `bun install` at the repo root otherwise produces an opaque
 * "Cannot find module '@typesafe-ai/sdk'" error.
 *
 * Zero cost when the install is present: two `existsSync` calls, no network, no clock.
 *
 * The gate only fires when `bun test` is run from the repo root, since bunfig.toml
 * resolves the preload path against the current working directory.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const SDK_PACKAGE = "@typesafe-ai/sdk";

/** Repo root, derived from this file's location (tests/preload/<file>). */
export const repoRoot = dirname(dirname(import.meta.dir));

/** Path of the Club-installed SDK package relative to a repo root. */
export function sdkPackageDir(rootDir: string): string {
  return join(rootDir, "apps", "club", "node_modules", SDK_PACKAGE);
}

/** True when the Club workspace has the SDK installed under `rootDir`. */
export function clubInstallStatus(rootDir: string): { installed: boolean; sdkDir: string } {
  const sdkDir = sdkPackageDir(rootDir);
  const installed = existsSync(sdkDir) && existsSync(join(sdkDir, "package.json"));
  return { installed, sdkDir };
}

/** The single message shown when the Club install is missing. */
export function missingSdkMessage(sdkDir: string): string {
  return [
    `Club dependencies are missing: ${SDK_PACKAGE} was not found at ${sdkDir}.`,
    "Root tests import apps/club/lib/longitudinal/*, so a plain `bun install` is not enough.",
    "Run `bun run club:install` before `bun test`.",
    'That step needs bun >= 1.4 (apps/club/bun.lock is lockfileVersion 2); on older bun it fails with "lockfile had changes, but lockfile is frozen" — upgrade bun, then retry.',
  ].join("\n");
}

/** Throws the message when the install is missing; silent otherwise. */
export function assertClubInstalled(rootDir: string): void {
  const { installed, sdkDir } = clubInstallStatus(rootDir);
  if (!installed) {
    throw new Error(missingSdkMessage(sdkDir));
  }
}

// Exit instead of throwing: exiting here guarantees that zero test files load and
// that the run emits exactly one message, whereas an uncaught throw is surfaced by
// bun as a preload error attributed to each test file it aborts.
const status = clubInstallStatus(repoRoot);
if (!status.installed) {
  console.error(`\n${missingSdkMessage(status.sdkDir)}\n`);
  process.exit(1);
}
