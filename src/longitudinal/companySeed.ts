import { PROJECT_CONFIG } from "../projectConfig/generated.ts";
import { hashInputs } from "../provenance/hash.ts";
import type { CompanySeed, SeedCompany, SeedInvestor } from "./companySeedShape.ts";

export { PINNED_COMPANY_SEED_HASH } from "../projectConfig/companySeedPin.ts";
export {
  COMPANY_STAGES,
  type CompanySeed,
  type CompanyStage,
  type HiringBar,
  type InvestorTier,
  type PublishedRate,
  type SeedCompany,
  type SeedInvestor,
  type SeedRound,
} from "./companySeedShape.ts";

export const COMPANY_SEED: CompanySeed = PROJECT_CONFIG.company_seed;

export function companySeedHash(seed: CompanySeed = COMPANY_SEED): string {
  return hashInputs(seed);
}

export function normalizeOrgName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.']/g, "")
    .replace(/\b(?:incorporated|inc|llc|ltd|limited|corp|corporation|company|co)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function companyByOrg(org: string, seed: CompanySeed): SeedCompany | undefined {
  const key = normalizeOrgName(org);
  if (!key) return undefined;
  return seed.companies.find((company) =>
    [company.name, ...company.aliases].some((name) => normalizeOrgName(name) === key),
  );
}

export function mentionedInvestors(text: string, seed: CompanySeed): SeedInvestor[] {
  const names: { name: string; investor: SeedInvestor }[] = [];
  for (const investor of seed.investors) {
    for (const name of [investor.name, ...investor.aliases]) {
      if (name.trim()) names.push({ name, investor });
    }
  }
  names.sort((left, right) => right.name.length - left.name.length);
  if (names.length === 0) return [];
  const pattern = names.map((entry) => escapeRegExp(entry.name)).join("|");
  const found: SeedInvestor[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(new RegExp(`\\b(?:${pattern})\\b`, "gi"))) {
    const token = match[0].toLowerCase();
    const hit = names.find((entry) => entry.name.toLowerCase() === token);
    if (!hit || seen.has(hit.investor.name)) continue;
    seen.add(hit.investor.name);
    found.push(hit.investor);
  }
  return found;
}

export function textHasLabel(text: string, label: string): boolean {
  return new RegExp(`\\b${escapeRegExp(label)}\\b`, "i").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
