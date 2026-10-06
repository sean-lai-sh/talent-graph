#!/usr/bin/env bun
/**
 * Writes src/projectConfig/generated.ts from config.yml.
 *
 *   bun run scripts/gen-config.ts [--check] [--config <path>] [--out <path>]
 *
 * --check writes nothing. It exits 1 when the generated file is stale or when
 * config.yml fails the pinned-hash checks.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  checkConfigFile,
  generatedConfigPath,
  loadProjectConfig,
  projectConfigPath,
} from "../src/projectConfig/load.ts";
import { renderConfigModule } from "../src/projectConfig/render.ts";

const USAGE = "usage: gen-config.ts [--check] [--config <path>] [--out <path>]";

function parseArgs(argv: readonly string[]): { check: boolean; config: string; out: string } {
  const options = { check: false, config: projectConfigPath(), out: generatedConfigPath() };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--check") {
      options.check = true;
      continue;
    }
    const value = argv[index + 1];
    if ((flag !== "--config" && flag !== "--out") || value === undefined) throw new Error(USAGE);
    if (flag === "--config") options.config = value;
    else options.out = value;
    index++;
  }
  return options;
}

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const expected = renderConfigModule(loadProjectConfig(options.config));
  if (options.check) {
    if (readOrEmpty(options.out) !== expected) {
      console.error(
        `${options.out} is out of date with ${options.config}. Run \`bun run config:gen\` and commit the result.`,
      );
      process.exit(1);
    }
    checkConfigFile(options.config);
    console.log(`${options.out} matches ${options.config}`);
  } else {
    writeFileSync(options.out, expected);
    console.log(`wrote ${options.out}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
