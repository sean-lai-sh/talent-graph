/**
 * The registry must be populated by importing the registry.
 *
 * `defineModel` registers as a side effect of the definition module running,
 * so a caller that imports only `src/models/registry.ts` (or the barrel that
 * re-exports it) and never names a definition file would otherwise see an
 * empty registry: `registeredModels()` → `[]`. These checks run in a fresh
 * process so no other test's imports can populate the map for them.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function inFreshProcess(source: string): string {
  const result = Bun.spawnSync(["bun", "-e", source], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new TextDecoder().decode(result.stderr);
  expect(stderr, stderr).toBe("");
  return new TextDecoder().decode(result.stdout).trim();
}

describe("importing the registry loads the shipped models", () => {
  test("registeredModels() sees all three in a fresh process", () => {
    const out = inFreshProcess(
      "const r = await import('./src/models/registry.ts'); console.log(r.registeredModels().length);",
    );
    expect(out).toBe("3");
  });

  test("getModel resolves a shipped model in a fresh process", () => {
    const out = inFreshProcess(
      "const r = await import('./src/models/registry.ts'); const d = r.getModel('referral_signal_v0'); console.log(d.name + '@' + d.kind);",
    );
    expect(out).toBe("referral_signal_v0@referral_signal");
  });

  test("the public barrel exposes a populated registry too", () => {
    const out = inFreshProcess(
      "const r = await import('./src/index.ts'); console.log(r.registeredModels().map((d) => d.name).sort().join(','));",
    );
    expect(out).toBe("bradley_terry_v1,judge_reliability_v2,referral_signal_v0");
  });
});
