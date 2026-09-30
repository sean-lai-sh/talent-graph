#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import type {
  LevelDistribution,
  RoleChoice,
  RoleDistribution,
} from "../src/longitudinal/claimRubricV12.ts";
import { scoreClaimValueV12 } from "../src/longitudinal/claimValue.ts";
import {
  type PersonRollup,
  personRollupHash,
  personRollups,
  type RollupClaim,
} from "../src/longitudinal/personRollup.ts";

export const ALPHA_SANITY_SEED = 0x5ea48;
export const VARIANTS_PER_ARCHETYPE = 4;

const ARCHETYPES = [
  "big_company_big_result",
  "big_company_thin_work",
  "obscure_maintainer",
  "hackathon",
] as const;

const MEDIAN_LOW = 0.4;
const MEDIAN_HIGH = 0.6;
const HIGH_ALPHA = 0.8;
const OBSERVED_AT = new Date(Date.UTC(2020, 5, 1));
const TIER = "externally_verified" as const;

type Archetype = (typeof ARCHETYPES)[number];

const LABELS: Record<Archetype, string> = {
  big_company_big_result: "big company, big result",
  big_company_thin_work: "big company, thin work",
  obscure_maintainer: "obscure maintainer",
  hackathon: "hackathon",
};

export interface ArchetypeMean {
  archetype: Archetype;
  label: string;
  n: number;
  alphaPercentile: number;
  alphaResidual: number;
  value: number;
}

export interface ExtraAlpha {
  personId: string;
  alpha: string;
  value: string;
}

export interface AlphaSanityReport {
  ok: boolean;
  text: string;
  cohortSize: number;
  means: ArchetypeMean[];
  extras: ExtraAlpha[];
  problems: string[];
}

const USAGE = [
  "usage: bun run scripts/jev-alpha-sanity.ts [--extra <path>]",
  "",
  'The extra file is a JSON array, or { "claims": [...] }.',
  "Each claim is { personId, id, claimClass, claimValue, status, observedAt }.",
  'claimClass is "selection" or "output". A funding claim is selection.',
  'status is "accepted", "review", or "no_work_described".',
  "observedAt is an ISO instant or YYYY-MM-DD.",
  "From claims.jsonl, copy resume to personId, claimId to id,",
  "and claimClass, claimValue, status, observedAt from each answered row.",
].join("\n");

export function syntheticCohort(seed = ALPHA_SANITY_SEED): RollupClaim[] {
  const rng = mulberry32(seed);
  return [...fillers(), ...variants(rng)];
}

export function orderingProblems(means: readonly ArchetypeMean[]): string[] {
  const byName = new Map(means.map((mean) => [mean.archetype, mean]));
  const maintainer = byName.get("obscure_maintainer");
  const big = byName.get("big_company_big_result");
  const thin = byName.get("big_company_thin_work");
  const hackathon = byName.get("hackathon");
  if (
    maintainer === undefined ||
    big === undefined ||
    thin === undefined ||
    hackathon === undefined
  ) {
    return ["missing archetype"];
  }
  const problems: string[] = [];
  if (
    !(
      maintainer.alphaPercentile > big.alphaPercentile &&
      maintainer.alphaPercentile > thin.alphaPercentile &&
      maintainer.alphaPercentile > hackathon.alphaPercentile &&
      maintainer.alphaPercentile >= HIGH_ALPHA
    )
  ) {
    problems.push("obscure maintainer alpha is not the highest");
  }
  if (big.alphaPercentile < MEDIAN_LOW || big.alphaPercentile > MEDIAN_HIGH) {
    problems.push("big company big result alpha is not near the median");
  }
  if (thin.alphaPercentile >= 0.5 || thin.alphaResidual >= 0) {
    problems.push("big company thin work alpha is not below the median");
  }
  if (hackathon.alphaPercentile >= 0.5 || hackathon.alphaResidual >= 0) {
    problems.push("hackathon alpha is not below the median");
  }
  return problems;
}

export function buildAlphaReport(claims: readonly RollupClaim[]): AlphaSanityReport {
  const rollups = personRollups({ claims });
  const cohortSize = fittedCount(rollups);
  const means: ArchetypeMean[] = [];
  const problems: string[] = [];
  if (cohortSize < 30) problems.push(`cohort ${cohortSize} is below 30`);
  for (const archetype of ARCHETYPES) {
    const members = [...rollups.values()].filter((row) => row.personId.startsWith(`${archetype}-`));
    const summary = meanOf(archetype, members);
    if (summary === null) {
      problems.push(`${LABELS[archetype]} has no defined alpha`);
      continue;
    }
    means.push(summary);
  }
  problems.push(...orderingProblems(means));
  const extras = [...rollups.values()]
    .filter((row) => kindOf(row.personId) === "extra")
    .map(extraLine);
  const text = render(cohortSize, means, extras, problems);
  return { ok: problems.length === 0, text, cohortSize, means, extras, problems };
}

export function parseExtraClaims(raw: unknown): RollupClaim[] {
  const list = claimsOf(raw);
  return list.map((entry, index) => parseClaim(entry, index));
}

export async function main(argv: readonly string[]): Promise<number> {
  const extraPath = parseArgs(argv);
  const extra =
    extraPath === undefined ? [] : parseExtraClaims(JSON.parse(await readFile(extraPath, "utf8")));
  const synthetic = syntheticCohort();
  const ids = new Set(synthetic.map((claim) => claim.personId));
  for (const claim of extra) {
    if (ids.has(claim.personId)) {
      throw new Error(`extra person ${claim.personId} collides with the synthetic cohort`);
    }
  }
  const report = buildAlphaReport([...synthetic, ...extra]);
  console.log(report.text);
  return report.ok ? 0 : 1;
}

function parseArgs(argv: readonly string[]): string | undefined {
  if (argv.length === 0) return undefined;
  if (argv.length === 2 && argv[0] === "--extra") {
    const path = argv[1];
    if (path === undefined || path.startsWith("--")) throw new Error(USAGE);
    return path;
  }
  throw new Error(USAGE);
}

function fillers(): RollupClaim[] {
  const claims: RollupClaim[] = [];
  for (let index = 0; index < 8; index++) {
    claims.push(
      ...profile(`filler-b0-${index}`, null, output(mass(1), mass(1), "original_author")),
    );
    claims.push(
      ...profile(
        `filler-b1-${index}`,
        selection(mass(2), mass(1)),
        output(mass(2), mass(1), "original_author"),
      ),
    );
    claims.push(
      ...profile(
        `filler-b2-${index}`,
        selection(mass(4), mass(2)),
        output(mass(2), mass(2), "original_author"),
      ),
    );
    claims.push(
      ...profile(
        `filler-b3-${index}`,
        selection(mass(4), mass(3)),
        output(mass(3), mass(3), "original_author"),
      ),
    );
  }
  for (let index = 0; index < 24; index++) {
    claims.push(
      ...profile(
        `filler-lift-${index}`,
        selection(mass(2), mass(1)),
        output(mass(4), mass(2), "original_author"),
      ),
    );
  }
  for (let index = 0; index < 6; index++) {
    claims.push(
      ...profile(
        `filler-intern-${index}`,
        selection(mass(4), mass(3)),
        output(mass(4), mass(3), "original_author"),
      ),
    );
  }
  return claims;
}

function variants(rng: () => number): RollupClaim[] {
  const claims: RollupClaim[] = [];
  for (let index = 0; index < VARIANTS_PER_ARCHETYPE; index++) {
    claims.push(
      ...profile(
        `big_company_big_result-${index}`,
        selection(mass(4, rng), mass(3, rng)),
        output(mass(3, rng), mass(3, rng), "original_author"),
      ),
    );
    claims.push(
      ...profile(
        `big_company_thin_work-${index}`,
        selection(mass(4, rng), mass(3, rng)),
        output(mass(1, rng), mass(1, rng), "original_author"),
      ),
    );
    claims.push(
      ...profile(
        `obscure_maintainer-${index}`,
        null,
        output(mass(4, rng), mass(3, rng), "maintainer"),
      ),
    );
    claims.push(
      ...profile(
        `hackathon-${index}`,
        selection(mass(4, rng), mass(2, rng)),
        output(mass(1), mass(0), "original_author"),
      ),
    );
  }
  return claims;
}

function profile(
  personId: string,
  selectionScore: { claimValue: number } | null,
  outputScore: { claimValue: number },
): RollupClaim[] {
  const claims: RollupClaim[] = [];
  if (selectionScore) {
    claims.push({
      id: `${personId}-selection`,
      personId,
      claimClass: "selection",
      claimValue: selectionScore.claimValue,
      status: "accepted",
      observedAt: new Date(OBSERVED_AT.getTime()),
    });
  }
  claims.push({
    id: `${personId}-output`,
    personId,
    claimClass: "output",
    claimValue: outputScore.claimValue,
    status: "accepted",
    observedAt: new Date(OBSERVED_AT.getTime()),
  });
  return claims;
}

function selection(selectivity: LevelDistribution, pool: LevelDistribution) {
  return scoreClaimValueV12(
    { claimClass: "selection", selectivity, pool_strength: pool, companyEvidence: null },
    TIER,
  );
}

function output(difficulty: LevelDistribution, scale: LevelDistribution, choice: RoleChoice) {
  return scoreClaimValueV12({ claimClass: "output", difficulty, scale, role: role(choice) }, TIER);
}

function mass(level: 0 | 1 | 2 | 3 | 4, rng?: () => number): LevelDistribution {
  const probabilities = [0, 0, 0, 0, 0] as [number, number, number, number, number];
  if (rng === undefined) {
    probabilities[level] = 1;
    return { score: level, confidence: 1, probabilities };
  }
  const wobble = rng() - 0.5;
  const share = Math.abs(wobble) * 0.08;
  const neighbor = (wobble >= 0 ? Math.min(4, level + 1) : Math.max(0, level - 1)) as
    | 0
    | 1
    | 2
    | 3
    | 4;
  if (neighbor === level || share === 0) {
    probabilities[level] = 1;
    return { score: level, confidence: 1, probabilities };
  }
  probabilities[level] = 1 - share;
  probabilities[neighbor] = share;
  const score = probabilities.reduce((sum, probability, index) => sum + probability * index, 0);
  return { score, confidence: 1, probabilities };
}

function role(choice: RoleChoice): RoleDistribution {
  return {
    choice,
    confidence: 1,
    probabilities: {
      original_author: choice === "original_author" ? 1 : 0,
      major_contributor: choice === "major_contributor" ? 1 : 0,
      maintainer: choice === "maintainer" ? 1 : 0,
      minor_part: choice === "minor_part" ? 1 : 0,
    },
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kindOf(personId: string): "archetype" | "filler" | "extra" {
  if (personId.startsWith("filler-")) return "filler";
  for (const archetype of ARCHETYPES) {
    if (personId.startsWith(`${archetype}-`)) return "archetype";
  }
  return "extra";
}

function fittedCount(rollups: ReadonlyMap<string, PersonRollup>): number {
  for (const row of rollups.values()) {
    if (row.alpha.state === "defined" || row.alpha.state === "not_enough_cohort") {
      return row.alpha.cohortSize;
    }
  }
  return 0;
}

function meanOf(archetype: Archetype, members: readonly PersonRollup[]): ArchetypeMean | null {
  if (members.length === 0) return null;
  let percentile = 0;
  let residual = 0;
  let value = 0;
  for (const member of members) {
    if (member.substance === null || member.value === null || member.alpha.state !== "defined") {
      return null;
    }
    percentile += member.alpha.percentile;
    residual += member.alpha.residual;
    value += member.value;
  }
  const n = members.length;
  return {
    archetype,
    label: LABELS[archetype],
    n,
    alphaPercentile: percentile / n,
    alphaResidual: residual / n,
    value: value / n,
  };
}

function extraLine(row: PersonRollup): ExtraAlpha {
  return {
    personId: row.personId,
    alpha: alphaCell(row),
    value: row.value === null ? "none" : row.value.toFixed(4),
  };
}

function alphaCell(row: PersonRollup): string {
  if (row.alpha.state === "defined") return row.alpha.percentile.toFixed(4);
  if (row.alpha.state === "not_enough_cohort") return "not_enough_cohort";
  return "no_output_evidence";
}

function render(
  cohortSize: number,
  means: readonly ArchetypeMean[],
  extras: readonly ExtraAlpha[],
  problems: readonly string[],
): string {
  const lines = [
    "# Jev alpha sanity",
    "",
    `Seed ${ALPHA_SANITY_SEED}.`,
    `Cohort ${cohortSize}. Minimum 30.`,
    `Person rollup hash ${personRollupHash()}.`,
    "",
    "| archetype | n | alpha_percentile | alpha_residual | value |",
    "| --- | --- | --- | --- | --- |",
    ...means.map(
      (mean) =>
        `| ${mean.label} | ${mean.n} | ${mean.alphaPercentile.toFixed(4)} | ${mean.alphaResidual.toFixed(4)} | ${mean.value.toFixed(4)} |`,
    ),
    "",
    "## Extra",
    "",
  ];
  if (extras.length === 0) lines.push("None.", "");
  else {
    lines.push("| person | alpha | value |", "| --- | --- | --- |");
    for (const extra of extras) {
      lines.push(`| ${extra.personId} | ${extra.alpha} | ${extra.value} |`);
    }
    lines.push("");
  }
  lines.push("## Ordering", "");
  if (problems.length === 0) lines.push("Section 10 ordering holds.", "");
  else for (const problem of problems) lines.push(problem);
  lines.push("");
  return lines.join("\n");
}

function claimsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw !== null && typeof raw === "object" && "claims" in raw && Array.isArray(raw.claims)) {
    return raw.claims;
  }
  throw new Error(USAGE);
}

function parseClaim(entry: unknown, index: number): RollupClaim {
  const where = `extra claims[${index}]`;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${where} must be an object`);
  }
  const record = entry as Record<string, unknown>;
  const personId = requiredString(record, "personId", where);
  const id = requiredString(record, "id", where);
  const claimClass = record.claimClass;
  if (claimClass !== "selection" && claimClass !== "output") {
    throw new Error(`${where}.claimClass must be selection or output`);
  }
  const status = record.status;
  if (status !== "accepted" && status !== "review" && status !== "no_work_described") {
    throw new Error(`${where}.status must be accepted, review, or no_work_described`);
  }
  const claimValue = record.claimValue;
  if (
    typeof claimValue !== "number" ||
    !Number.isFinite(claimValue) ||
    claimValue < 0 ||
    claimValue > 1
  ) {
    throw new Error(`${where}.claimValue must be a number in [0, 1]`);
  }
  const observedAt = record.observedAt;
  if (typeof observedAt !== "string") throw new Error(`${where}.observedAt must be an instant`);
  return {
    id,
    personId,
    claimClass,
    claimValue,
    status,
    observedAt: parseInstant(observedAt, where),
  };
}

function requiredString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

function parseInstant(value: string, where: string): Date {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error(`${where}.observedAt must be an instant`);
  return date;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
