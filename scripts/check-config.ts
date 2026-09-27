#!/usr/bin/env bun
import {
  checkConfigFile,
  loadProjectConfig,
  projectConfigPath,
} from "../src/projectConfig/load.ts";
import { hashInputs } from "../src/provenance/hash.ts";

const path = process.argv[2] ?? projectConfigPath();

try {
  const hash = checkConfigFile(path);
  const rollupHash = hashInputs(loadProjectConfig(path).person_rollup);
  console.log(`${path} ok`);
  console.log(`company_seed ${hash}`);
  console.log(`person_rollup ${rollupHash}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
