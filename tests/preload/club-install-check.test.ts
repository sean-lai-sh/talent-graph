import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertClubInstalled,
  clubInstallStatus,
  missingSdkMessage,
  repoRoot,
  SDK_PACKAGE,
  sdkPackageDir,
} from "./club-install-check.ts";

const scratch = mkdtempSync(join(tmpdir(), "54-b6-club-install-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function fakeRoot(name: string, mode: "missing" | "dir-only" | "installed"): string {
  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  if (mode !== "missing") {
    const sdkDir = sdkPackageDir(root);
    mkdirSync(sdkDir, { recursive: true });
    if (mode === "installed") {
      writeFileSync(join(sdkDir, "package.json"), JSON.stringify({ name: SDK_PACKAGE }));
    }
  }
  return root;
}

describe("club install check", () => {
  test("reports missing when the SDK directory is absent", () => {
    const root = fakeRoot("absent", "missing");
    const status = clubInstallStatus(root);
    expect(status.installed).toBe(false);
    expect(status.sdkDir).toBe(sdkPackageDir(root));
  });

  test("reports missing when the SDK directory has no package.json", () => {
    expect(clubInstallStatus(fakeRoot("empty", "dir-only")).installed).toBe(false);
  });

  test("reports installed when the SDK package.json is present", () => {
    expect(clubInstallStatus(fakeRoot("ok", "installed")).installed).toBe(true);
  });

  test("message names club:install, the bun version requirement and the path", () => {
    const sdkDir = sdkPackageDir("/repo");
    const message = missingSdkMessage(sdkDir);
    expect(message).toContain("bun run club:install");
    expect(message).toContain("bun >= 1.4");
    expect(message).toContain("lockfile is frozen");
    expect(message).toContain(sdkDir);
    expect(message).toContain(SDK_PACKAGE);
  });

  test("assertClubInstalled throws the message when missing and is silent otherwise", () => {
    const missingRoot = fakeRoot("throws", "missing");
    expect(() => assertClubInstalled(missingRoot)).toThrow("bun run club:install");
    expect(() => assertClubInstalled(fakeRoot("silent", "installed"))).not.toThrow();
  });

  test("the real repo root is detected as installed in this worktree", () => {
    expect(clubInstallStatus(repoRoot).installed).toBe(true);
  });
});
