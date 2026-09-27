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
