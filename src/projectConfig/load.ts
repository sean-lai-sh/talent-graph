/**
 * Reads config.yml from disk. Tooling only: scripts and tests import this.
 * Scoring code imports the generated module (generated.ts) instead, because
 * Convex has no filesystem and does not bundle config.yml.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ConfigError,
  checkConfigText,
  DOCUMENT,
  type ProjectConfig,
  parseProjectConfig,
} from "./parse.ts";

export function projectConfigPath(): string {
  return fileURLToPath(new URL("../../config.yml", import.meta.url));
}

export function generatedConfigPath(): string {
  return fileURLToPath(new URL("./generated.ts", import.meta.url));
}

export function loadProjectConfig(path = projectConfigPath()): ProjectConfig {
  return parseProjectConfig(readConfigText(path));
}

export function checkConfigFile(path: string): string {
  try {
    return checkConfigText(readConfigText(path));
  } catch (error) {
    if (error instanceof ConfigError && error.message.startsWith(`${DOCUMENT}:`)) {
      throw new ConfigError(`${path}${error.message.slice(DOCUMENT.length)}`);
    }
    throw error;
  }
}

function readConfigText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`cannot read ${path}: ${detail}`);
  }
}
