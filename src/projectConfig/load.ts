import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  COMPANY_STAGES,
  type CompanySeed,
  type CompanyStage,
  type InvestorTier,
  type PublishedRate,
  type SeedCompany,
  type SeedInvestor,
  type SeedRound,
} from "../longitudinal/companySeedShape.ts";
import { hashInputs } from "../provenance/hash.ts";
import { PINNED_COMPANY_SEED_HASH } from "./companySeedPin.ts";

const DOCUMENT = "config.yml";

const SECTIONS = {
  company_seed: parseCompanySeed,
} as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ProjectConfig {
  company_seed: CompanySeed;
}

export function projectConfigPath(): string {
  return fileURLToPath(new URL("../../config.yml", import.meta.url));
}

export function loadProjectConfig(path = projectConfigPath()): ProjectConfig {
  return parseProjectConfig(readConfigText(path));
}

/** Schema-check every registered section, then pin `company_seed`. */
export function checkConfigText(text: string): string {
  const config = parseProjectConfig(text);
  const hash = hashInputs(config.company_seed);
  if (hash !== PINNED_COMPANY_SEED_HASH) {
    fail(
      DOCUMENT,
      `company_seed hash ${hash} does not match pinned hash ${PINNED_COMPANY_SEED_HASH}`,
    );
  }
  return hash;
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

export function parseProjectConfig(text: string): ProjectConfig {
  const raw = parseYaml(text);
  if (!isRecord(raw)) fail(DOCUMENT, "document must be a map");
  const known = Object.keys(SECTIONS);
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) fail(DOCUMENT, `unknown section "${key}"`);
  }
  for (const key of known) {
    if (!(key in raw)) fail(DOCUMENT, `missing section "${key}"`);
  }
  return {
    company_seed: SECTIONS.company_seed(raw.company_seed),
  };
}

function readConfigText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`cannot read ${path}: ${detail}`);
  }
}

function parseYaml(text: string): unknown {
  try {
    return parse(text, { schema: "core", strict: true, uniqueKeys: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${DOCUMENT}: invalid YAML: ${detail}`);
  }
}

function parseCompanySeed(value: unknown): CompanySeed {
  const where = `${DOCUMENT}: company_seed`;
  if (!isRecord(value)) fail(where, "must be a map");
  requireKeys(value, ["investors", "companies"], where);
  return {
    investors: parseInvestors(value.investors, `${where}.investors`),
    companies: parseCompanies(value.companies, `${where}.companies`),
  };
}

function parseInvestors(value: unknown, where: string): SeedInvestor[] {
  if (!Array.isArray(value)) fail(where, "must be a list");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const investor = parseInvestor(entry, `${where}[${index}]`);
    if (seen.has(investor.name)) fail(`${where}[${index}]`, `duplicate id "${investor.name}"`);
    seen.add(investor.name);
    return investor;
  });
}

function parseInvestor(value: unknown, where: string): SeedInvestor {
  if (!isRecord(value)) fail(where, "must be a map");
  requireKeys(value, ["name", "aliases", "tier", "source", "publishedRates"], where);
  const name = idString(value.name, `${where}.name`);
  return {
    name,
    aliases: stringList(value.aliases, `${where}.aliases`),
    tier: parseTier(value.tier, `${where}.tier`),
    source: httpsSource(value.source, `${where}.source`, "entry"),
    publishedRates: parseRates(value.publishedRates, `${where}.publishedRates`),
  };
}

function parseCompanies(value: unknown, where: string): SeedCompany[] {
  if (!Array.isArray(value)) fail(where, "must be a list");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const company = parseCompany(entry, `${where}[${index}]`);
    if (seen.has(company.name)) fail(`${where}[${index}]`, `duplicate id "${company.name}"`);
    seen.add(company.name);
    return company;
  });
}

function parseCompany(value: unknown, where: string): SeedCompany {
  if (!isRecord(value)) fail(where, "must be a map");
  requireKeys(
    value,
    ["name", "aliases", "source", "currentStage", "rounds", "publishedRate", "hiringBar"],
    where,
  );
  return {
    name: idString(value.name, `${where}.name`),
    aliases: stringList(value.aliases, `${where}.aliases`),
    source: httpsSource(value.source, `${where}.source`, "entry"),
    currentStage: parseStage(value.currentStage, `${where}.currentStage`),
    rounds: parseRounds(value.rounds, `${where}.rounds`),
    publishedRate: parseOptionalRate(value.publishedRate, `${where}.publishedRate`),
    hiringBar: parseHiringBar(value.hiringBar, `${where}.hiringBar`),
  };
}

function parseRounds(value: unknown, where: string): SeedRound[] {
  if (!Array.isArray(value)) fail(where, "must be a list");
  return value.map((entry, index) => parseRound(entry, `${where}[${index}]`));
}

function parseRound(value: unknown, where: string): SeedRound {
  if (!isRecord(value)) fail(where, "must be a map");
  requireKeys(value, ["date", "stage", "investors", "source"], where);
  return {
    date: calendarDate(value.date, `${where}.date`),
    stage: parseStage(value.stage, `${where}.stage`),
    investors: stringList(value.investors, `${where}.investors`),
    source: httpsSource(value.source, `${where}.source`, "entry"),
  };
}

function parseRates(value: unknown, where: string): PublishedRate[] {
  if (!Array.isArray(value)) fail(where, "must be a list");
  return value.map((entry, index) => parseRate(entry, `${where}[${index}]`));
}

function parseOptionalRate(value: unknown, where: string): PublishedRate | null {
  if (value === null) return null;
  return parseRate(value, where);
}

function parseRate(value: unknown, where: string): PublishedRate {
  if (!isRecord(value)) fail(where, "must be a map");
  if ("estimated" in value || "inferred" in value) {
    fail(where, "rate is estimated or inferred; only a published rate with a source is allowed");
  }
  requireKeys(value, ["rate", "upperBound", "source", "labels"], where);
  if (!("rate" in value)) fail(where, "missing rate");
  if (!("upperBound" in value)) fail(where, "missing upperBound");
  const rate = parseFraction(value.rate, `${where}.rate`);
  if (typeof value.upperBound !== "boolean") fail(`${where}.upperBound`, "must be a boolean");
  const source = httpsSource(value.source, `${where}.source`, "rate");
  if (!("labels" in value)) return { rate, upperBound: value.upperBound, source };
  return {
    rate,
    upperBound: value.upperBound,
    source,
    labels: parseLabels(value.labels, `${where}.labels`),
  };
}

function parseHiringBar(value: unknown, where: string): { source: string } | null {
  if (value === null) return null;
  if (!isRecord(value)) fail(where, "must be a map or null");
  requireKeys(value, ["source"], where);
  return { source: httpsSource(value.source, `${where}.source`, "entry") };
}

function parseTier(value: unknown, where: string): InvestorTier {
  if (value === 1 || value === 2 || value === 3) return value;
  fail(where, "must be 1, 2, or 3");
}

function parseStage(value: unknown, where: string): CompanyStage {
  if (typeof value === "string" && (COMPANY_STAGES as readonly string[]).includes(value)) {
    return value as CompanyStage;
  }
  fail(where, `must be ${COMPANY_STAGES.join(", ")}`);
}

function parseFraction(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    fail(where, "must be a fraction greater than 0 and at most 1");
  }
  return value;
}

function parseLabels(value: unknown, where: string): [string, ...string[]] {
  const labels = stringList(value, where);
  const first = labels[0];
  if (!first) fail(where, "must name at least one program");
  return [first, ...labels.slice(1)];
}

function calendarDate(value: unknown, where: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(where, "must be YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== (month ?? 0) - 1 ||
    date.getUTCDate() !== day
  ) {
    fail(where, "must be YYYY-MM-DD");
  }
  return value;
}

function idString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(where, "missing id");
  return value;
}

function stringList(value: unknown, where: string): string[] {
  if (value === undefined) fail(where, "missing field");
  if (!Array.isArray(value)) fail(where, "must be a list");
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      fail(`${where}[${index}]`, "must be a non-empty string");
    }
    return item;
  });
}

function httpsSource(value: unknown, where: string, kind: "entry" | "rate"): string {
  const missing = kind === "rate" ? "published rate is missing a source URL" : "missing source URL";
  const invalid =
    kind === "rate"
      ? "published rate source is not a valid https URL"
      : "source URL is not a valid https URL";
  if (typeof value !== "string" || value.trim() === "") fail(where, missing);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(where, invalid);
  }
  if (url.protocol !== "https:") fail(where, invalid);
  return value;
}

function requireKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail(where, `unknown field "${key}"`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(where: string, message: string): never {
  throw new ConfigError(`${where}: ${message}`);
}
