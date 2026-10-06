import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPANY_SEED, PINNED_COMPANY_SEED_HASH } from "../src/longitudinal/companySeed.ts";
import { PERSON_ROLLUP, PINNED_PERSON_ROLLUP_HASH } from "../src/longitudinal/personRollup.ts";
import { PROJECT_CONFIG } from "../src/projectConfig/generated.ts";
import {
  generatedConfigPath,
  loadProjectConfig,
  projectConfigPath,
} from "../src/projectConfig/load.ts";
import { renderConfigModule } from "../src/projectConfig/render.ts";
import { hashInputs } from "../src/provenance/hash.ts";

const SCRIPT = join(import.meta.dir, "../scripts/gen-config.ts");

function check(config: string, out: string): { code: number; stderr: string } {
  const run = Bun.spawnSync(["bun", "run", SCRIPT, "--check", "--config", config, "--out", out]);
  return { code: run.exitCode, stderr: run.stderr.toString() };
}

async function workspace(): Promise<{ config: string; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), "gen-config-"));
  const config = join(dir, "config.yml");
  const out = join(dir, "generated.ts");
  await writeFile(config, await readFile(projectConfigPath(), "utf8"));
  await writeFile(out, await readFile(generatedConfigPath(), "utf8"));
  return { config, out };
}

describe("generated config module", () => {
  test("the committed module is what config.yml renders to", async () => {
    expect(await readFile(generatedConfigPath(), "utf8")).toBe(
      renderConfigModule(loadProjectConfig()),
    );
  });

  test("it holds the same values as reading config.yml, under the pinned hashes", () => {
    expect(PROJECT_CONFIG).toEqual(loadProjectConfig());
    expect(hashInputs(COMPANY_SEED)).toBe(PINNED_COMPANY_SEED_HASH);
    expect(hashInputs(PERSON_ROLLUP)).toBe(PINNED_PERSON_ROLLUP_HASH);
  });

  test("it is deeply frozen", () => {
    expect(Object.isFrozen(PROJECT_CONFIG)).toBe(true);
    expect(Object.isFrozen(PERSON_ROLLUP.consensusCuts)).toBe(true);
    expect(Object.isFrozen(COMPANY_SEED.investors[0])).toBe(true);
  });

  test("the check passes when the module matches config.yml", async () => {
    const ws = await workspace();
    expect(check(ws.config, ws.out).code).toBe(0);
  });

  test("the check fails when config.yml is edited without regenerating", async () => {
    const ws = await workspace();
    const text = await readFile(ws.config, "utf8");
    const edited = text.replace(/topN: \d+/, (match) => `topN: ${Number(match.slice(6)) + 1}`);
    expect(edited).not.toBe(text);
    await writeFile(ws.config, edited);
    const result = check(ws.config, ws.out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("out of date");
  });

  test("the check fails when the module is edited by hand or missing", async () => {
    const ws = await workspace();
    await writeFile(ws.out, `${await readFile(ws.out, "utf8")}// edited\n`);
    expect(check(ws.config, ws.out).code).toBe(1);
    expect(check(ws.config, join(ws.out, "..", "missing.ts")).code).toBe(1);
  });
});
