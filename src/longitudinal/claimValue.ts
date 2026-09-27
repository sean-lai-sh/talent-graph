/**
 * One number for a `career_evidence@1.1.0` claim, and the slope over those numbers.
 *
 * `v(k) = (k / maxLevel) ^ p` is applied to each level, then the expectation
 * is the sum of `P(k) * v(k)`. Selection uses curved selectivity. Output uses
 * the geometric mean of curved difficulty and curved generalized impact.
 * Ownership and backing multiply that class value. The product is clamped
 * to [0, 1].
 *
 * `careerEventsToLongitudinalRecords` and `residualSlope` stay on the 1.0.0
 * path. This module does not rank-normalize, and a selection is an outcome.
 */

import type { Outcome } from "../domain/types.ts";
import { deepFreeze } from "../models/freeze.ts";
import { hashInputs } from "../provenance/hash.ts";
import type { LevelDistribution, OwnershipDistribution } from "./claimRubricV11.ts";
import type { LongitudinalResidualSlope } from "./types.ts";

export const EVIDENCE_TIERS = ["self_reported", "corroborated", "externally_verified"] as const;

export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

export interface ClaimValueConfig {
  kind: "claim_value";
  version: "1.1.0";
  /** `p` in `v(k) = (k / maxLevel) ^ p`. */
  curvePower: number;
  maxLevel: number;
  ownership: {
    led: number;
    core_contributor: number;
    supporting: number;
  };
  backing: Record<EvidenceTier, number>;
}

export const CLAIM_VALUE_V1_1_0: ClaimValueConfig = deepFreeze({
  kind: "claim_value",
  version: "1.1.0",
  curvePower: 2,
  maxLevel: 4,
  ownership: {
    led: 1,
    core_contributor: 0.8,
    supporting: 0.5,
  },
  backing: {
    self_reported: 0.6,
    corroborated: 0.85,
    externally_verified: 1,
  },
});

export type ClaimValueSubject =
  | {
      claimClass: "selection";
      selectivity: LevelDistribution;
      ownership: OwnershipDistribution | null;
    }
  | {
      claimClass: "output";
      difficulty: LevelDistribution;
      generalized_impact: LevelDistribution;
      ownership: OwnershipDistribution | null;
    };

export interface ClaimValueScore {
  configId: string;
  configVersion: ClaimValueConfig["version"];
  configHash: string;
  claimClass: ClaimValueSubject["claimClass"];
  curved: {
    selectivity: number | null;
    difficulty: number | null;
    generalizedImpact: number | null;
  };
  classValue: number;
  ownershipMultiplier: number;
  backingMultiplier: number;
  claimValue: number;
}

export interface ValuedClaim {
  id: string;
  personId: string;
  claimClass: ClaimValueSubject["claimClass"];
  claimValue: number;
  status: "accepted" | "review";
  observedAt: Date;
  createdAt: Date;
}

export function claimValueConfigHash(config: ClaimValueConfig): string {
  return hashInputs({
    kind: config.kind,
    version: config.version,
    curvePower: config.curvePower,
    maxLevel: config.maxLevel,
    ownership: config.ownership,
    backing: config.backing,
  });
}

export function claimValueConfigId(config: ClaimValueConfig): string {
  return `${config.kind}@${config.version}:${claimValueConfigHash(config).slice(0, 8)}`;
}

export function scoreClaimValue(
  claim: ClaimValueSubject,
  evidenceTier: EvidenceTier,
  config: ClaimValueConfig = CLAIM_VALUE_V1_1_0,
): ClaimValueScore {
  assertConfig(config);
  const curved = classOf(claim, config);
  const ownershipMultiplier = ownershipOf(claim.ownership, config);
  const backingMultiplier = backingOf(evidenceTier, config);
  const raw = curved.classValue * ownershipMultiplier * backingMultiplier;
  if (!Number.isFinite(raw)) {
    throw new Error("claim value: product is not a finite number");
  }
  return {
    configId: claimValueConfigId(config),
    configVersion: config.version,
    configHash: claimValueConfigHash(config),
    claimClass: claim.claimClass,
    curved: curved.curved,
    classValue: curved.classValue,
    ownershipMultiplier,
    backingMultiplier,
    claimValue: clampUnit(raw),
  };
}

/**
 * Accepted claims become outcomes. A selection is an outcome whose `value`
 * is its claim value. Review claims are left out. No opportunity is written.
 */
export function claimValuesToLongitudinalRecords(claims: readonly ValuedClaim[]): {
  outcomes: Outcome[];
  opportunities: [];
} {
  const outcomes: Outcome[] = [];
  for (const claim of claims) {
    if (claim.status !== "accepted") continue;
    if (!Number.isFinite(claim.claimValue)) continue;
    outcomes.push({
      id: `outcome-${claim.id}`,
      personId: claim.personId,
      opportunityId: null,
      kind: `career_claim:${claim.claimClass}`,
      value: claim.claimValue,
      observedAt: new Date(claim.observedAt.getTime()),
      createdAt: new Date(claim.createdAt.getTime()),
    });
  }
  return { outcomes, opportunities: [] };
}

/**
 * Difference of mean claim values at two cutoffs.
 *
 * The value at a cutoff is the mean of this person's outcome values observed
 * at or before that cutoff, selections included. Values are not rank-normalized
 * within kind. The state names match `residualSlope`.
 */
export function claimValueSlope(
  personId: string,
  t0: Date,
  t1: Date,
  outcomes: readonly Outcome[],
  minGapDays: number,
): LongitudinalResidualSlope {
  const gapDays = (t1.getTime() - t0.getTime()) / 86_400_000;
  const window = {
    personId,
    t0: new Date(t0.getTime()),
    t1: new Date(t1.getTime()),
  };
  if (!Number.isFinite(gapDays) || gapDays < minGapDays) {
    return {
      ...window,
      residualT0: null,
      residualT1: null,
      delta: null,
      state: "undefined_window",
    };
  }
  const early = meanClaimValue(outcomes, personId, t0);
  const late = meanClaimValue(outcomes, personId, t1);
  if (early === null) {
    return {
      ...window,
      residualT0: null,
      residualT1: late,
      delta: null,
      state: "insufficient_early",
    };
  }
  if (late === null) {
    return {
      ...window,
      residualT0: early,
      residualT1: null,
      delta: null,
      state: "insufficient_late",
    };
  }
  return {
    ...window,
    residualT0: early,
    residualT1: late,
    delta: late - early,
    state: "defined",
  };
}

function assertConfig(config: ClaimValueConfig): void {
  if (!Number.isFinite(config.curvePower) || config.curvePower < 0) {
    throw new Error(
      `claim value: curvePower must be a finite number ≥ 0 (got ${String(config.curvePower)})`,
    );
  }
  if (!Number.isInteger(config.maxLevel) || config.maxLevel <= 0) {
    throw new Error(
      `claim value: maxLevel must be a positive integer (got ${String(config.maxLevel)})`,
    );
  }
}

function classOf(
  claim: ClaimValueSubject,
  config: ClaimValueConfig,
): Pick<ClaimValueScore, "classValue" | "curved"> {
  if (claim.claimClass === "selection") {
    const selectivity = curvedExpectation(claim.selectivity, config, "selectivity");
    return {
      classValue: selectivity,
      curved: { selectivity, difficulty: null, generalizedImpact: null },
    };
  }
  const difficulty = curvedExpectation(claim.difficulty, config, "difficulty");
  const generalizedImpact = curvedExpectation(
    claim.generalized_impact,
    config,
    "generalized_impact",
  );
  return {
    classValue: Math.sqrt(difficulty * generalizedImpact),
    curved: { selectivity: null, difficulty, generalizedImpact },
  };
}

function curvedExpectation(
  distribution: LevelDistribution,
  config: ClaimValueConfig,
  what: string,
): number {
  if (distribution.probabilities.length !== config.maxLevel + 1) {
    throw new Error(
      `claim value: ${what} has ${distribution.probabilities.length} probabilities; ` +
        `maxLevel ${config.maxLevel} needs ${config.maxLevel + 1}`,
    );
  }
  let value = 0;
  for (let level = 0; level <= config.maxLevel; level++) {
    const probability = distribution.probabilities[level];
    if (typeof probability !== "number" || !Number.isFinite(probability)) {
      throw new Error(`claim value: ${what} probability at level ${level} is not finite`);
    }
    value += probability * (level / config.maxLevel) ** config.curvePower;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`claim value: curved ${what} is not finite`);
  }
  return value;
}

function ownershipOf(ownership: OwnershipDistribution | null, config: ClaimValueConfig): number {
  if (ownership === null || ownership === undefined) {
    return finiteWeight(config.ownership.core_contributor, "ownership fallback");
  }
  const multiplier =
    ownership.probabilities.led * config.ownership.led +
    ownership.probabilities.core_contributor * config.ownership.core_contributor +
    ownership.probabilities.supporting * config.ownership.supporting;
  return finiteWeight(multiplier, "ownership multiplier");
}

function backingOf(tier: EvidenceTier, config: ClaimValueConfig): number {
  return finiteWeight(config.backing[tier], `backing.${String(tier)}`);
}

function finiteWeight(value: number, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`claim value: ${what} must be a finite number (got ${String(value)})`);
  }
  return value;
}

function clampUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function meanClaimValue(outcomes: readonly Outcome[], personId: string, at: Date): number | null {
  const atMs = at.getTime();
  let sum = 0;
  let count = 0;
  for (const outcome of outcomes) {
    if (outcome.personId !== personId || outcome.observedAt.getTime() > atMs) continue;
    if (outcome.value === null || !Number.isFinite(outcome.value)) continue;
    sum += outcome.value;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}
