#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { callGrokRoutine } from "../apps/club/lib/longitudinal/grok.ts";
import { CLAIM_VALUE_V1_2_0, claimValueV12ConfigHash } from "../src/longitudinal/claimValue.ts";
import {
  type CompanyResearchProposal,
  type CompanyWorkItem,
  companyWorklist,
  type GrokResearchResult,
  mergeSeedCompanies,
  parseCompanyResearchProposals,
  parseGrokResearchResponse,
} from "../src/longitudinal/companyResearch.ts";
import {
  COMPANY_SEED,
  type CompanySeed,
  companyByOrg,
  normalizeOrgName,
} from "../src/longitudinal/companySeed.ts";
import { projectConfigPath } from "../src/projectConfig/load.ts";
import { parseSmokeItems } from "./jev-claim-smoke.ts";

const USAGE = [
  "usage: bun run scripts/jev-company-worklist.ts",
  "  --items <smoke-items.json>                        print the company worklist",
  "  --research <smoke-items.json> --out <proposals>   ask the Grok routine about unseeded orgs",
  "  --from <grok-reply.json> --out <proposals>        validate a reply saved by hand",
  "  --apply <proposals.json>                          merge proposals into config.yml",
].join("\n");

const BATCH = 10;

export interface ResearchDeps {
  fetcher: typeof fetch;
  env: Record<string, string | undefined>;
  runId: () => string;
}

const DEFAULT_DEPS: ResearchDeps = {
  fetcher: fetch,
  env: process.env,
  runId: () => crypto.randomUUID(),
};

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
  deps: ResearchDeps = DEFAULT_DEPS,
): Promise<string> {
  const [flag, path, ...rest] = argv;
  if (!path) throw new Error(USAGE);
  if (flag === "--research" || flag === "--from") {
    if (rest.length !== 2 || rest[0] !== "--out" || !rest[1]) throw new Error(USAGE);
    const run: ResearchRun =
      flag === "--research"
        ? await research(await worklistFrom(path, seed), deps)
        : {
            result: parseGrokResearchResponse(JSON.parse(await readFile(path, "utf8")), null),
            unmatched: [],
            failure: null,
          };
    await writeFile(rest[1], `${JSON.stringify(run.result.companies, null, 2)}\n`);
    const report = researchReport(run, rest[1]);
    if (run.failure !== null) throw new Error(report);
    return report;
  }
  if (rest.length > 0) throw new Error(USAGE);
  if (flag === "--items") {
    return `${JSON.stringify(await worklistFrom(path, seed), null, 2)}\n`;
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
      `claim_value@1.2.0 ${claimValueHash}: claims scored under this seed carry this config hash`,
      unknown.length === 0
        ? "every round investor is a seeded investor"
        : `round investors with no seed entry (they add no tier): ${unknown.join(", ")}`,
      "",
    ].join("\n");
  }
  throw new Error(USAGE);
}

async function worklistFrom(path: string, seed: CompanySeed): Promise<CompanyWorkItem[]> {
  const items = parseSmokeItems(JSON.parse(await readFile(path, "utf8")));
  const lines = items.map((item) => ({
    id: item.id,
    statement: item.statement,
    publishedAt: item.publishedAt,
  }));
  return companyWorklist(lines, seed);
}

interface ResearchRun {
  result: GrokResearchResult;
  /** Worklist orgs no returned company names, by name or alias. They stay unseeded. */
  unmatched: string[];
  /** Why the run stopped early. Batches before it are kept. */
  failure: string | null;
}

async function research(
  work: readonly CompanyWorkItem[],
  deps: ResearchDeps,
): Promise<ResearchRun> {
  const url = deps.env.GROK_ROUTINE_WEBHOOK_URL;
  const key = deps.env.GROK_ROUTINE_KEY;
  const missing = [url ? null : "GROK_ROUTINE_WEBHOOK_URL", key ? null : "GROK_ROUTINE_KEY"].filter(
    Boolean,
  );
  if (!url || !key) throw new Error(`set ${missing.join(" and ")} (Doppler talent-graph/dev)`);
  const unseeded = work.filter((item) => item.seeded === null);
  const total: GrokResearchResult = {
    companies: [],
    rejected: [],
    unresolved: [],
    newInvestors: [],
  };
  for (let start = 0; start < unseeded.length; start += BATCH) {
    const runId = deps.runId();
    const worklist = unseeded.slice(start, start + BATCH).map((item) => ({
      org: item.org,
      titles: item.titles,
      startedAt: item.earliestStartedAt,
    }));
    let batch: GrokResearchResult;
    try {
      batch = parseGrokResearchResponse(
        await callGrokRoutine(url, key, { runId, worklist }, deps.fetcher),
        runId,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { result: total, unmatched: [], failure: `batch ${start / BATCH + 1}: ${reason}` };
    }
    for (const company of batch.companies) {
      if (total.companies.some((kept) => kept.name === company.name)) {
        total.rejected.push({ org: company.name, error: "returned again in a later batch" });
      } else {
        total.companies.push(company);
      }
    }
    total.rejected.push(...batch.rejected);
    total.unresolved.push(...batch.unresolved);
    total.newInvestors.push(...batch.newInvestors);
  }
  const returned: CompanySeed = { investors: [], companies: total.companies };
  const unresolved = new Set(total.unresolved.map((entry) => normalizeOrgName(entry.org)));
  const unmatched = unseeded
    .map((item) => item.org)
    .filter((org) => !unresolved.has(normalizeOrgName(org)) && !companyByOrg(org, returned));
  return { result: total, unmatched, failure: null };
}

function researchReport(run: ResearchRun, out: string): string {
  const { result } = run;
  const lines = [`wrote ${result.companies.length} proposals to ${out}`];
  if (run.failure !== null) lines.push(`stopped at ${run.failure}; earlier batches were written`);
  for (const org of run.unmatched) {
    lines.push(
      `unmatched ${org}: no returned company has this name or alias, so it stays unseeded`,
    );
  }
  for (const entry of result.rejected) lines.push(`rejected ${entry.org}: ${entry.error}`);
  for (const entry of result.unresolved) lines.push(`unresolved ${entry.org}: ${entry.reason}`);
  const investors = [...new Set(result.newInvestors)];
  if (investors.length > 0) {
    lines.push(
      `new investors, not applied; add them to company_seed.investors with a tier: ${investors.join(", ")}`,
    );
  }
  lines.push(`next: bun run scripts/jev-company-worklist.ts --apply ${out}`, "");
  return lines.join("\n");
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
