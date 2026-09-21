import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  test("a real `bun test` run in a tree without Club deps aborts with one message", () => {
    const tree = join(scratch, "subprocess-run");
    mkdirSync(join(tree, "tests", "preload"), { recursive: true });
    copyFileSync(
      join(import.meta.dir, "club-install-check.ts"),
      join(tree, "tests", "preload", "club-install-check.ts"),
    );
    writeFileSync(
      join(tree, "bunfig.toml"),
      '[test]\nroot = "tests"\npreload = ["./tests/preload/club-install-check.ts"]\n',
    );
    writeFileSync(
      join(tree, "tests", "dummy.test.ts"),
      'import { expect, test } from "bun:test";\ntest("dummy", () => {\n  expect(1).toBe(1);\n});\n',
    );

    const run = Bun.spawnSync(["bun", "test"], { cwd: tree, stdout: "pipe", stderr: "pipe" });
    const stderr = run.stderr.toString();

    expect(run.exitCode).toBe(1);
    expect(stderr).toContain("bun run club:install");
    expect(stderr.split("Club dependencies are missing").length - 1).toBe(1);
  });
});
