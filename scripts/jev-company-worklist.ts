#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CLAIM_VALUE_V1_2_0, claimValueV12ConfigHash } from "../src/longitudinal/claimValue.ts";
import {
  type CompanyResearchProposal,
  companyWorklist,
  mergeSeedCompanies,
  parseCompanyResearchProposals,
} from "../src/longitudinal/companyResearch.ts";
import { COMPANY_SEED, type CompanySeed } from "../src/longitudinal/companySeed.ts";
import { projectConfigPath } from "../src/projectConfig/load.ts";
import { parseSmokeItems } from "./jev-claim-smoke.ts";

const USAGE =
  "usage: bun run scripts/jev-company-worklist.ts (--items <smoke-items.json> | --apply <proposals.json>)";

export interface WorklistPaths {
  config: string;
  pin: string;
}

const DEFAULT_PATHS: WorklistPaths = {
  config: projectConfigPath(),
  pin: fileURLToPath(new URL("../src/projectConfig/companySeedPin.ts", import.meta.url)),
};

export async function main(
  argv: readonly string[],
  paths: WorklistPaths = DEFAULT_PATHS,
  seed: CompanySeed = COMPANY_SEED,
): Promise<string> {
  const [flag, path, ...rest] = argv;
  if (!path || rest.length > 0) throw new Error(USAGE);
  if (flag === "--items") {
    const items = parseSmokeItems(JSON.parse(await readFile(path, "utf8")));
    const lines = items.map((item) => ({
      id: item.id,
      statement: item.statement,
      publishedAt: item.publishedAt,
    }));
    return `${JSON.stringify(companyWorklist(lines, seed), null, 2)}\n`;
  }
  if (flag === "--apply") {
    const proposals = parseCompanyResearchProposals(JSON.parse(await readFile(path, "utf8")));
    const merged = mergeSeedCompanies(await readFile(paths.config, "utf8"), proposals);
    const pin = await readFile(paths.pin, "utf8");
    await writeFile(paths.config, merged.text);
    await writeFile(paths.pin, pin.replace(/"[0-9a-f]{64}"/, `"${merged.hash}"`));
    const claimValueHash = claimValueV12ConfigHash({
      ...CLAIM_VALUE_V1_2_0,
      companySeedHash: merged.hash,
    });
    const unknown = unseededInvestors(proposals, seed);
    return [
      `merged ${proposals.map((proposal) => proposal.name).join(", ")} into ${paths.config}`,
      `company_seed ${merged.hash} written to ${paths.pin}`,
      `claim_value@1.2.0 ${claimValueHash}: set PINNED_V12_CONFIG_HASH in tests/claimValueV12.test.ts to this`,
      unknown.length === 0
        ? "every round investor is a seeded investor"
        : `round investors with no seed entry (they add no tier): ${unknown.join(", ")}`,
      "",
    ].join("\n");
  }
  throw new Error(USAGE);
}

function unseededInvestors(
  proposals: readonly CompanyResearchProposal[],
  seed: CompanySeed,
): string[] {
  const known = new Set(seed.investors.flatMap((investor) => [investor.name, ...investor.aliases]));
  const names = proposals.flatMap((proposal) =>
    proposal.rounds.flatMap((round) => round.investors),
  );
  return [...new Set(names.filter((name) => !known.has(name)))];
}

if (import.meta.main) {
  try {
    process.stdout.write(await main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
