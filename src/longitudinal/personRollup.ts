import { rankPercentiles } from "../domain/rank.ts";
import { expectedFromBucketMeans, opportunityBucket } from "../judges/outcomes.ts";
import { deepFreeze } from "../models/freeze.ts";
import {
  loadProjectConfig,
  type PersonRollupConfig,
  parsePersonRollup,
} from "../projectConfig/load.ts";
import { hashInputs } from "../provenance/hash.ts";
import { CLAIM_VALUE_V1_2_0 } from "./claimValue.ts";

export type { PersonRollupConfig } from "../projectConfig/load.ts";
export { PINNED_PERSON_ROLLUP_HASH } from "../projectConfig/personRollupPin.ts";

export const PERSON_ROLLUP: PersonRollupConfig = deepFreeze(loadProjectConfig().person_rollup);

/** Not part of `personRollupHash`. `person_rollup` has no bucket-cut keys. */
export const CONSENSUS_BUCKET_EDGES: readonly number[] = Object.freeze(consensusBucketEdges());

export type RollupClaimStatus = "accepted" | "review" | "no_work_described";

export interface RollupClaim {
  id: string;
  personId: string;
  claimClass: "selection" | "output";
  claimValue: number;
  status: RollupClaimStatus;
  /** Instant the claim counts. Callers resolve job dates before this. */
  observedAt: Date;
}

export interface PersonRollupInput {
  claims: readonly RollupClaim[];
  /** Centered at 0. A missing person is 0. Applied at every cutoff. */
  trend?: ReadonlyMap<string, number>;
  /** Claims observed after this instant are left out. */
  asOf?: Date;
  config?: PersonRollupConfig;
}

export type PersonAlpha =
  | {
      state: "defined";
      percentile: number;
      residual: number;
      expectedSubstance: number;
      bucket: number;
      expectedFrom: "bucket" | "global";
      cohortSize: number;
    }
  | {
      state: "not_enough_cohort";
      cohortSize: number;
      minCohortSize: number;
    }
  | { state: "no_output_evidence" };

type RollupBase = {
  personId: string;
  asOf: Date | null;
  selectionAggregate: number;
  selectionClaimIds: readonly string[];
  trend: number;
  consensus: number;
  outputClaimIds: readonly string[];
  personRollupHash: string;
};

export type PersonRollup = RollupBase &
  (
    | {
        substance: number;
        value: number;
        alpha: Exclude<PersonAlpha, { state: "no_output_evidence" }>;
      }
    | { substance: null; value: null; alpha: { state: "no_output_evidence" } }
  );

export interface AlphaSlopeInput {
  claims: readonly RollupClaim[];
  t0: Date;
  t1: Date;
  minGapDays: number;
  trend?: ReadonlyMap<string, number>;
  config?: PersonRollupConfig;
}

export type AlphaSlope = {
  personId: string;
  t0: Date;
  t1: Date;
  personRollupHash: string;
} & (
  | { state: "defined"; alphaT0: number; alphaT1: number; delta: number }
  | { state: "insufficient_early"; alphaT0: null; alphaT1: number | null; delta: null }
  | { state: "insufficient_late"; alphaT0: number; alphaT1: null; delta: null }
  | { state: "undefined_window"; alphaT0: null; alphaT1: null; delta: null }
);

interface ClassPick {
  mean: number | null;
  ids: string[];
}

interface FittedPerson {
  personId: string;
  consensus: number;
  substance: number;
}

export function personRollupHash(config: PersonRollupConfig = PERSON_ROLLUP): string {
  return hashInputs(parsePersonRollup(config, "person_rollup"));
}

export function personRollups(input: PersonRollupInput): Map<string, PersonRollup> {
  const config = parsePersonRollup(input.config ?? PERSON_ROLLUP, "person_rollup");
  assertClaims(input.claims);
  assertTrend(input.trend);
  assertInstant(input.asOf, "asOf");
  const stamp = hashInputs(config);
  const asOf = input.asOf ? new Date(input.asOf.getTime()) : null;
  const ids = roster(input.claims, input.trend);
  const fitted: FittedPerson[] = [];
  const pending = new Map<string, RollupBase & { substance: number; value: number }>();
  const noOutput = new Map<string, PersonRollup>();

  for (const personId of ids) {
    const trend = input.trend?.get(personId) ?? 0;
    const selection = topAccepted(input.claims, personId, "selection", config.topN, asOf);
    const output = topAccepted(input.claims, personId, "output", config.topN, asOf);
    const selectionAggregate = selection.mean ?? 0;
    const consensus = selectionAggregate + config.wTrend * trend;
    const base: RollupBase = {
      personId,
      asOf: asOf ? new Date(asOf.getTime()) : null,
      selectionAggregate,
      selectionClaimIds: selection.ids,
      trend,
      consensus,
      outputClaimIds: output.ids,
      personRollupHash: stamp,
    };
    if (output.mean === null) {
      noOutput.set(personId, {
        ...base,
        substance: null,
        value: null,
        alpha: { state: "no_output_evidence" },
      });
      continue;
    }
    fitted.push({ personId, consensus, substance: output.mean });
    pending.set(personId, {
      ...base,
      substance: output.mean,
      value: config.wSubstance * output.mean + config.wConsensus * consensus,
    });
  }

  const alphas = fitAlphas(fitted, config);
  const rows = new Map<string, PersonRollup>();
  for (const personId of ids) {
    const missing = noOutput.get(personId);
    if (missing) {
      rows.set(personId, missing);
      continue;
    }
    const partial = pending.get(personId);
    const alpha = alphas.get(personId);
    if (!partial || !alpha) throw new Error(`person roll-up: missing fit for ${personId}`);
    rows.set(personId, { ...partial, alpha });
  }
  return rows;
}

export function alphaSlopes(input: AlphaSlopeInput): Map<string, AlphaSlope> {
  const config = parsePersonRollup(input.config ?? PERSON_ROLLUP, "person_rollup");
  assertClaims(input.claims);
  assertTrend(input.trend);
  assertInstant(input.t0, "t0");
  assertInstant(input.t1, "t1");
  const gapDays = (input.t1.getTime() - input.t0.getTime()) / 86_400_000;
  const ids = roster(input.claims, input.trend);
  const stamp = hashInputs(config);
  const t0 = new Date(input.t0.getTime());
  const t1 = new Date(input.t1.getTime());
  if (!Number.isFinite(gapDays) || gapDays < input.minGapDays) {
    const rows = new Map<string, AlphaSlope>();
    for (const personId of ids) {
      rows.set(personId, {
        personId,
        t0: new Date(t0.getTime()),
        t1: new Date(t1.getTime()),
        personRollupHash: stamp,
        state: "undefined_window",
        alphaT0: null,
        alphaT1: null,
        delta: null,
      });
    }
    return rows;
  }

  const early = personRollups({
    claims: input.claims,
    ...(input.trend ? { trend: input.trend } : {}),
    asOf: t0,
    config,
  });
  const late = personRollups({
    claims: input.claims,
    ...(input.trend ? { trend: input.trend } : {}),
    asOf: t1,
    config,
  });
  const rows = new Map<string, AlphaSlope>();
  for (const personId of ids) {
    const alphaT0 = definedPercentile(early.get(personId));
    const alphaT1 = definedPercentile(late.get(personId));
    const common = {
      personId,
      t0: new Date(t0.getTime()),
      t1: new Date(t1.getTime()),
      personRollupHash: stamp,
    };
    if (alphaT0 === null) {
      rows.set(personId, { ...common, state: "insufficient_early", alphaT0, alphaT1, delta: null });
      continue;
    }
    if (alphaT1 === null) {
      rows.set(personId, { ...common, state: "insufficient_late", alphaT0, alphaT1, delta: null });
      continue;
    }
    rows.set(personId, {
      ...common,
      state: "defined",
      alphaT0,
      alphaT1,
      delta: alphaT1 - alphaT0,
    });
  }
  return rows;
}

function consensusBucketEdges(): number[] {
  const { curvePower, maxLevel } = CLAIM_VALUE_V1_2_0;
  const edges: number[] = [];
  for (let level = 1; level < maxLevel; level++) {
    edges.push((level / maxLevel) ** curvePower);
  }
  return edges;
}

function fitAlphas(
  fitted: readonly FittedPerson[],
  config: PersonRollupConfig,
): Map<string, Exclude<PersonAlpha, { state: "no_output_evidence" }>> {
  const alphas = new Map<string, Exclude<PersonAlpha, { state: "no_output_evidence" }>>();
  if (fitted.length < config.minCohortSize) {
    for (const person of fitted) {
      alphas.set(person.personId, {
        state: "not_enough_cohort",
        cohortSize: fitted.length,
        minCohortSize: config.minCohortSize,
      });
    }
    return alphas;
  }

  const ordered = [...fitted].sort((a, b) => compareIds(a.personId, b.personId));
  const globalMean = meanOf(ordered.map((person) => person.substance));
  const bucketValues = new Map<number, number[]>();
  const bucketOf = new Map<string, number>();
  for (const person of ordered) {
    const bucket = opportunityBucket(person.consensus, CONSENSUS_BUCKET_EDGES);
    bucketOf.set(person.personId, bucket);
    const list = bucketValues.get(bucket);
    if (list) list.push(person.substance);
    else bucketValues.set(bucket, [person.substance]);
  }
  const bucketMeans = new Map<number, { mean: number; size: number }>();
  for (const [bucket, values] of bucketValues) {
    bucketMeans.set(bucket, { mean: meanOf(values), size: values.length });
  }

  const residuals: { id: string; value: number }[] = [];
  const expectations = new Map<
    string,
    { expected: number; from: "bucket" | "global"; bucket: number }
  >();
  for (const person of ordered) {
    const bucket = bucketOf.get(person.personId);
    if (bucket === undefined)
      throw new Error(`person roll-up: missing bucket for ${person.personId}`);
    const expectation = expectedFromBucketMeans(
      bucketMeans,
      bucket,
      globalMean,
      config.minBucketSize,
    );
    expectations.set(person.personId, { ...expectation, bucket });
    residuals.push({ id: person.personId, value: person.substance - expectation.expected });
  }
  const percentiles = rankPercentiles(residuals);
  for (const person of ordered) {
    const expectation = expectations.get(person.personId);
    const percentile = percentiles.get(person.personId);
    if (!expectation || percentile === undefined) {
      throw new Error(`person roll-up: missing alpha for ${person.personId}`);
    }
    alphas.set(person.personId, {
      state: "defined",
      percentile: percentile / 100,
      residual: person.substance - expectation.expected,
      expectedSubstance: expectation.expected,
      bucket: expectation.bucket,
      expectedFrom: expectation.from,
      cohortSize: ordered.length,
    });
  }
  return alphas;
}

function topAccepted(
  claims: readonly RollupClaim[],
  personId: string,
  claimClass: "selection" | "output",
  topN: number,
  asOf: Date | null,
): ClassPick {
  const accepted = claims.filter(
    (claim) =>
      claim.personId === personId &&
      claim.claimClass === claimClass &&
      claim.status === "accepted" &&
      (asOf === null || claim.observedAt.getTime() <= asOf.getTime()),
  );
  accepted.sort((a, b) => b.claimValue - a.claimValue || compareIds(a.id, b.id));
  const top = accepted.slice(0, topN);
  if (top.length === 0) return { mean: null, ids: [] };
  return { mean: meanOf(top.map((claim) => claim.claimValue)), ids: top.map((claim) => claim.id) };
}

function roster(
  claims: readonly RollupClaim[],
  trend: ReadonlyMap<string, number> | undefined,
): string[] {
  const ids = new Set<string>();
  for (const claim of claims) ids.add(claim.personId);
  if (trend) for (const personId of trend.keys()) ids.add(personId);
  return [...ids].sort();
}

function definedPercentile(row: PersonRollup | undefined): number | null {
  if (row === undefined || row.alpha.state !== "defined") return null;
  return row.alpha.percentile;
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function meanOf(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function assertClaims(claims: readonly RollupClaim[]): void {
  const seen = new Set<string>();
  for (const claim of claims) {
    if (claim.id.trim() === "" || claim.personId.trim() === "") {
      throw new Error("person roll-up: claim id and personId must be non-empty");
    }
    const key = `${claim.personId}\0${claim.id}`;
    if (seen.has(key)) {
      throw new Error(`person roll-up: duplicate claim id "${claim.id}" for ${claim.personId}`);
    }
    seen.add(key);
    assertInstant(claim.observedAt, `claim ${claim.id} observedAt`);
    if (claim.claimClass !== "selection" && claim.claimClass !== "output") {
      throw new Error(`person roll-up: claim ${claim.id} has class ${String(claim.claimClass)}`);
    }
    if (
      claim.status !== "accepted" &&
      claim.status !== "review" &&
      claim.status !== "no_work_described"
    ) {
      throw new Error(`person roll-up: claim ${claim.id} has status ${String(claim.status)}`);
    }
    if (
      claim.status === "accepted" &&
      (!Number.isFinite(claim.claimValue) || claim.claimValue < 0 || claim.claimValue > 1)
    ) {
      throw new Error(`person roll-up: accepted claim ${claim.id} value must be in [0, 1]`);
    }
  }
}

function assertTrend(trend: ReadonlyMap<string, number> | undefined): void {
  if (!trend) return;
  for (const [personId, value] of trend) {
    if (personId.trim() === "") throw new Error("person roll-up: trend personId must be non-empty");
    if (!Number.isFinite(value))
      throw new Error(`person roll-up: trend for ${personId} must be finite`);
  }
}

function assertInstant(value: Date | undefined, label: string): void {
  if (value === undefined) return;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`person roll-up: ${label} must be a valid instant`);
  }
}
