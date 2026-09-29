import { deepFreeze } from "../models/freeze.ts";
import { hashInputs } from "../provenance/hash.ts";
import {
  COMPANY_SEED,
  type CompanySeed,
  type CompanyStage,
  companyByOrg,
  type HiringBar,
  mentionedInvestors,
  type PublishedRate,
  type SeedCompany,
  type SeedInvestor,
  type SeedRound,
  textHasLabel,
} from "./companySeed.ts";

export interface CompanySelectionQuery {
  org: string | null;
  startedAt: string | null;
  founder: boolean;
  fundingText?: string | null;
}

export interface KnownSelectionRate {
  rate: number;
  source: string;
  upperBound: boolean;
}

export interface CompanySelectionEvidence {
  knownRate: KnownSelectionRate | null;
  investorTier: 0 | 1 | 2 | 3 | null;
  /** The seeded investor behind `investorTier`, when that tier is 1 or higher. */
  topInvestor: string | null;
  stageAtHire: CompanyStage | null;
  /** The company's hiring bar, only when the hire landed at growth or public stage. */
  hiringBar: HiringBar | null;
  proxyLift: 0 | 1;
  joinedEarly: boolean;
  earlyJoinerBonus: number;
}

export interface CompanyEvidenceConfig {
  proxyLiftCap: number;
  maxProxyLevel: number;
  earlyJoinerBonus: number;
  earlyJoinerBonusMax: number;
}

export const COMPANY_EVIDENCE_CONFIG: CompanyEvidenceConfig = deepFreeze({
  proxyLiftCap: 1,
  maxProxyLevel: 3,
  earlyJoinerBonus: 0,
  earlyJoinerBonusMax: 0.25,
});

const STAGE_RANK: Record<CompanyStage, number> = {
  pre_seed_seed: 0,
  series_a_b: 1,
  growth_late: 2,
  public_large: 3,
};

export function companyEvidenceConfigHash(
  config: CompanyEvidenceConfig = COMPANY_EVIDENCE_CONFIG,
): string {
  return hashInputs(config);
}

export function companySelectionEvidence(
  query: CompanySelectionQuery,
  seed: CompanySeed = COMPANY_SEED,
  config: CompanyEvidenceConfig = COMPANY_EVIDENCE_CONFIG,
): CompanySelectionEvidence {
  const company = query.org ? companyByOrg(query.org, seed) : undefined;
  const fundingText = query.fundingText ?? "";
  const named = query.founder ? mentionedInvestors(fundingText, seed) : [];
  const known = knownRateFor(query.founder, fundingText, named, company);
  const observed = observedAtHire(query.startedAt, company, named, seed);
  const joinedEarly = isJoinedEarly(observed.stage, company?.currentStage ?? null);
  const hiringBar = isLate(observed.stage) ? (company?.hiringBar ?? null) : null;
  return {
    knownRate: known
      ? { rate: known.rate, source: known.source, upperBound: known.upperBound }
      : null,
    investorTier: observed.tier,
    topInvestor: observed.top?.name ?? null,
    stageAtHire: observed.stage,
    hiringBar,
    proxyLift: proxyLiftFor(known, observed.stage, observed.tier, hiringBar),
    joinedEarly,
    earlyJoinerBonus: joinedEarly ? clampedBonus(config) : 0,
  };
}

export function applyProxyLift(
  textOnlyLevel: number,
  evidence: CompanySelectionEvidence,
  config: CompanyEvidenceConfig = COMPANY_EVIDENCE_CONFIG,
): 0 | 1 | 2 | 3 | 4 {
  const level = asLevel(textOnlyLevel);
  if (evidence.knownRate) return level;
  const cap = Math.max(0, Math.floor(config.proxyLiftCap));
  const lift = evidence.proxyLift === 0 ? 0 : Math.min(evidence.proxyLift, cap);
  const raised = level + lift;
  const ceiling = Math.min(Math.floor(config.maxProxyLevel), 3);
  const next = raised <= ceiling ? raised : Math.max(level, ceiling);
  return asLevel(next);
}

function knownRateFor(
  founder: boolean,
  fundingText: string,
  named: readonly SeedInvestor[],
  company: SeedCompany | undefined,
): PublishedRate | null {
  if (founder)
    return tightest(
      named.flatMap((investor) => matchingRates(investor.publishedRates, fundingText)),
    );
  return (
    matchingRates(company?.publishedRate ? [company.publishedRate] : [], fundingText)[0] ?? null
  );
}

function matchingRates(rates: readonly PublishedRate[], text: string): PublishedRate[] {
  return rates.filter(
    (rate) => !rate.labels || rate.labels.some((label) => textHasLabel(text, label)),
  );
}

function tightest(rates: readonly PublishedRate[]): PublishedRate | null {
  let best: PublishedRate | null = null;
  for (const rate of rates) {
    if (!best || rate.rate < best.rate) best = rate;
  }
  return best;
}

function observedAtHire(
  startedAt: string | null,
  company: SeedCompany | undefined,
  named: readonly SeedInvestor[],
  seed: CompanySeed,
): { tier: 0 | 1 | 2 | 3 | null; top: SeedInvestor | null; stage: CompanyStage | null } {
  if (startedAt === null) return { tier: null, top: null, stage: null };
  const prior = company ? company.rounds.filter((round) => round.date <= startedAt) : [];
  const stage = latestRound(prior)?.stage ?? null;
  if (!company && named.length === 0) return { tier: null, top: null, stage };
  const backers = [
    ...prior.flatMap((round) => round.investors.flatMap((name) => seededInvestor(name, seed))),
    ...named,
  ];
  const top = strongest(backers);
  return { tier: top?.tier ?? 0, top, stage };
}

function latestRound(rounds: readonly SeedRound[]): SeedRound | null {
  let best: SeedRound | null = null;
  for (const round of rounds) {
    if (!best || round.date >= best.date) best = round;
  }
  return best;
}

function seededInvestor(name: string, seed: CompanySeed): SeedInvestor[] {
  const investor = seed.investors.find((item) => item.name === name || item.aliases.includes(name));
  return investor ? [investor] : [];
}

function strongest(investors: readonly SeedInvestor[]): SeedInvestor | null {
  let best: SeedInvestor | null = null;
  for (const investor of investors) {
    if (!best || investor.tier > best.tier) best = investor;
  }
  return best;
}

function proxyLiftFor(
  known: PublishedRate | null,
  stage: CompanyStage | null,
  tier: 0 | 1 | 2 | 3 | null,
  hiringBar: HiringBar | null,
): 0 | 1 {
  if (known) return 0;
  if (stage === "pre_seed_seed" || stage === "series_a_b") {
    return tier !== null && tier >= 1 ? 1 : 0;
  }
  return hiringBar ? 1 : 0;
}

function isLate(stage: CompanyStage | null): boolean {
  return stage === "growth_late" || stage === "public_large";
}

function isJoinedEarly(atHire: CompanyStage | null, current: CompanyStage | null): boolean {
  if (!atHire || !current) return false;
  return STAGE_RANK[current] - STAGE_RANK[atHire] >= 2;
}

function clampedBonus(config: CompanyEvidenceConfig): number {
  if (!Number.isFinite(config.earlyJoinerBonus) || config.earlyJoinerBonus <= 0) return 0;
  return Math.min(config.earlyJoinerBonus, config.earlyJoinerBonusMax);
}

function asLevel(level: number): 0 | 1 | 2 | 3 | 4 {
  if (level === 0 || level === 1 || level === 2 || level === 3 || level === 4) return level;
  throw new Error(`selection level must be an integer 0..4 (got ${String(level)})`);
}
