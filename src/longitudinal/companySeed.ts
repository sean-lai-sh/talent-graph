import { deepFreeze } from "../models/freeze.ts";
import { hashInputs } from "../provenance/hash.ts";

export const COMPANY_STAGES = [
  "pre_seed_seed",
  "series_a_b",
  "growth_late",
  "public_large",
] as const;
export type CompanyStage = (typeof COMPANY_STAGES)[number];

export type InvestorTier = 1 | 2 | 3;

/**
 * A rate the source page states. `upperBound` is set when the page gives a
 * ceiling ("under 1%") rather than a point. `labels` binds the rate to one
 * program so a batch figure is not applied to every claim for that investor.
 */
export interface PublishedRate {
  rate: number;
  upperBound: boolean;
  source: string;
  labels?: readonly [string, ...string[]];
}

export interface SeedInvestor {
  name: string;
  aliases: readonly string[];
  tier: InvestorTier;
  source: string;
  publishedRates: readonly PublishedRate[];
}

export interface SeedRound {
  date: string;
  stage: CompanyStage;
  investors: readonly string[];
  source: string;
}

export interface SeedCompany {
  name: string;
  aliases: readonly string[];
  source: string;
  currentStage: CompanyStage;
  rounds: readonly SeedRound[];
  publishedRate: PublishedRate | null;
  hiringBar: { source: string } | null;
}

export interface CompanySeed {
  investors: readonly SeedInvestor[];
  companies: readonly SeedCompany[];
}

export const COMPANY_SEED: CompanySeed = deepFreeze({
  investors: [
    {
      name: "Y Combinator",
      aliases: ["YC"],
      tier: 3,
      source: "https://www.ycombinator.com/blog/meet-the-yc-winter-2024-batch/",
      publishedRates: [
        {
          rate: 0.01,
          upperBound: true,
          source: "https://www.ycombinator.com/blog/meet-the-yc-winter-2024-batch/",
          labels: ["W24", "Winter 2024"],
        },
      ],
    },
    {
      name: "Sequoia",
      aliases: [],
      tier: 3,
      source: "https://www.sequoiacap.com/",
      publishedRates: [],
    },
    {
      name: "Andreessen Horowitz",
      aliases: [],
      tier: 3,
      source: "https://a16z.com/",
      publishedRates: [],
    },
    {
      name: "Benchmark",
      aliases: [],
      tier: 3,
      source: "https://www.benchmark.com/",
      publishedRates: [],
    },
    {
      name: "Accel",
      aliases: [],
      tier: 2,
      source: "https://www.accel.com/",
      publishedRates: [],
    },
    {
      name: "Greylock",
      aliases: [],
      tier: 2,
      source: "https://greylock.com/",
      publishedRates: [],
    },
    {
      name: "Index Ventures",
      aliases: [],
      tier: 2,
      source: "https://www.indexventures.com/",
      publishedRates: [],
    },
    {
      name: "Precursor Ventures",
      aliases: ["Precursor VC"],
      tier: 1,
      source: "https://precursorvc.com/",
      publishedRates: [],
    },
    {
      name: "Hustle Fund",
      aliases: [],
      tier: 1,
      source: "https://www.hustlefund.vc/",
      publishedRates: [],
    },
  ],
  companies: [],
});

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
