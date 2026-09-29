import { isMap, isNode, isScalar, parseDocument, stringify } from "yaml";
import { ConfigError, parseProjectConfig, parseSeedCompany } from "../projectConfig/load.ts";
import { hashInputs } from "../provenance/hash.ts";
import {
  type DatedClaim,
  type JobClaimLine,
  preprocessJobClaims,
  type SplitClaim,
} from "./claimPreprocess.ts";
import {
  COMPANY_EVIDENCE_CONFIG,
  type CompanySelectionEvidence,
  companySelectionEvidence,
} from "./companyEvidence.ts";
import {
  COMPANY_SEED,
  type CompanySeed,
  companyByOrg,
  normalizeOrgName,
  type SeedCompany,
} from "./companySeed.ts";

/**
 * What a researcher (a Grok routine, or an agent with web search) returns
 * for one org. It is a `company_seed` entry, so the config parser is its
 * validator and a valid proposal merges as is.
 */
export type CompanyResearchProposal = SeedCompany;

export interface CompanyWorkItem {
  org: string;
  titles: string[];
  earliestStartedAt: string | null;
  /** The seed company this org already matches, by name or alias. */
  seeded: string | null;
  /** Evidence for the claim with the earliest start, under the current seed. */
  evidence: CompanySelectionEvidence;
}

export function parseCompanyResearchProposals(raw: unknown): CompanyResearchProposal[] {
  if (!Array.isArray(raw)) throw new ConfigError("proposals: must be a JSON array");
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const where = `proposals[${index}]`;
    const proposal = parseSeedCompany(entry, where);
    if (seen.has(proposal.name)) throw new ConfigError(`${where}: duplicate "${proposal.name}"`);
    seen.add(proposal.name);
    return proposal;
  });
}

/**
 * Returns config text with each company upserted into
 * `company_seed.companies` by name, and the new `company_seed` hash. Only
 * the `companies` list is rewritten: the rest of the file keeps its bytes,
 * and applying the same companies twice returns the same text.
 */
export function mergeSeedCompanies(
  text: string,
  companies: readonly SeedCompany[],
): { text: string; hash: string } {
  const list = [...parseProjectConfig(text).company_seed.companies];
  for (const company of companies) {
    const index = list.findIndex((entry) => entry.name === company.name);
    if (index === -1) list.push(company);
    else list[index] = company;
  }
  const doc = parseDocument(text);
  const seedMap = doc.get("company_seed", true);
  const pair = isMap(seedMap)
    ? seedMap.items.find((item) => isScalar(item.key) && item.key.value === "companies")
    : undefined;
  const keyRange = isScalar(pair?.key) ? pair.key.range : undefined;
  const valueRange = isNode(pair?.value) ? pair.value.range : undefined;
  if (!keyRange || !valueRange) {
    throw new ConfigError("config.yml: company_seed.companies: must be a list");
  }
  const indent = " ".repeat(keyRange[0] - text.lastIndexOf("\n", keyRange[0] - 1) - 1);
  const block = stringify({ companies: list })
    .trimEnd()
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${indent}${line}`))
    .join("\n");
  const gap = /\s*$/.exec(text.slice(keyRange[0], valueRange[1]))?.[0] ?? "";
  const merged = `${text.slice(0, keyRange[0])}${block}${gap}${text.slice(valueRange[1])}`;
  const seed = parseProjectConfig(merged).company_seed;
  const owners = new Map<string, string>();
  for (const company of seed.companies) {
    for (const name of [company.name, ...company.aliases]) {
      const key = normalizeOrgName(name);
      const owner = owners.get(key);
      if (owner !== undefined && owner !== company.name) {
        throw new ConfigError(
          `config.yml: company_seed.companies: "${name}" names both ${owner} and ${company.name}`,
        );
      }
      owners.set(key, company.name);
    }
  }
  return { text: merged, hash: hashInputs(seed) };
}

/** Distinct hire and funding orgs in `lines`, in first-seen order. */
export function companyWorklist(
  lines: readonly JobClaimLine[],
  seed: CompanySeed = COMPANY_SEED,
): CompanyWorkItem[] {
  const groups = new Map<string, DatedSelection[]>();
  for (const claim of preprocessJobClaims(lines, { version: "1.2.0", seed })) {
    if (!isDatedSelection(claim)) continue;
    const key = normalizeOrgName(claim.org);
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }
  return [...groups.values()].map((claims) => {
    const earliest = claims.reduce((best, claim) => (before(claim, best) ? claim : best));
    return {
      org: earliest.org,
      titles: [...new Set(claims.map((claim) => claim.title))],
      earliestStartedAt: earliest.startedAt,
      seeded: companyByOrg(earliest.org, seed)?.name ?? null,
      evidence: companySelectionEvidence(
        {
          org: earliest.org,
          startedAt: earliest.startedAt,
          founder: earliest.founder,
          fundingText: earliest.founder ? earliest.text : null,
        },
        seed,
        COMPANY_EVIDENCE_CONFIG,
      ),
    };
  });
}

type DatedSelection = DatedClaim & { claimClass: "selection" };

function isDatedSelection(claim: SplitClaim): claim is DatedSelection {
  return "claimClass" in claim && claim.claimClass === "selection";
}

function before(left: DatedSelection, right: DatedSelection): boolean {
  if (left.startedAt === null) return false;
  return right.startedAt === null || left.startedAt < right.startedAt;
}
