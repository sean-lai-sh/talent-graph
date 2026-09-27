#!/usr/bin/env bun
import { checkConfigFile, projectConfigPath } from "../src/projectConfig/load.ts";

const path = process.argv[2] ?? projectConfigPath();

try {
  const hash = checkConfigFile(path);
  console.log(`${path} ok`);
  console.log(`company_seed ${hash}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
