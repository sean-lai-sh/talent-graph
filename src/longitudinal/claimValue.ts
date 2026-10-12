import type { Outcome } from "../domain/types.ts";
import { deepFreeze } from "../models/freeze.ts";
import { hashInputs } from "../provenance/hash.ts";
import { type JobDateFields, observedAtForJobClaim } from "./claimPreprocess.ts";
import type { LevelDistribution, OwnershipDistribution } from "./claimRubricV11.ts";
import type {
  LevelDistribution as LevelDistributionV12,
  RoleDistribution,
} from "./claimRubricV12.ts";
import {
  applyProxyLift,
  COMPANY_EVIDENCE_CONFIG,
  type CompanySelectionEvidence,
  companyEvidenceConfigHash,
} from "./companyEvidence.ts";
import { companySeedHash } from "./companySeed.ts";
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

export interface ClaimValueV12Config {
  kind: "claim_value";
  version: "1.2.0";
  /** `p` in `v(k) = (k / maxLevel) ^ p`. */
  curvePower: number;
  maxLevel: number;
  role: {
    original_author: number;
    major_contributor: number;
    maintainer: number;
    minor_part: number;
  };
  backing: Record<EvidenceTier, number>;
  companyEvidenceConfigHash: string;
  companySeedHash: string;
}

export const CLAIM_VALUE_V1_2_0: ClaimValueV12Config = deepFreeze({
  kind: "claim_value",
  version: "1.2.0",
  curvePower: 2,
  maxLevel: 4,
  role: {
    original_author: 1,
    major_contributor: 0.8,
    maintainer: 0.65,
    minor_part: 0.5,
  },
  backing: {
    self_reported: 0.6,
    corroborated: 0.85,
    externally_verified: 1,
  },
  companyEvidenceConfigHash: companyEvidenceConfigHash(),
  companySeedHash: companySeedHash(),
});

export interface ReferrerNote {
  claimId: string;
  referrerName: string;
}

export type ClaimValueV12Subject =
  | {
      claimClass: "selection";
      selectivity: LevelDistributionV12;
      pool_strength: LevelDistributionV12;
      companyEvidence: CompanySelectionEvidence | null;
    }
  | {
      claimClass: "output";
      difficulty: LevelDistributionV12;
      scale: LevelDistributionV12;
      role: RoleDistribution | null;
    };

export interface ClaimValueV12Score {
  configId: string;
  configVersion: ClaimValueV12Config["version"];
  configHash: string;
  claimClass: ClaimValueV12Subject["claimClass"];
  curved: {
    selectivity: number | null;
    poolStrength: number | null;
    difficulty: number | null;
    scale: number | null;
  };
  classValue: number;
  roleMultiplier: number;
  backingMultiplier: number;
  claimValue: number;
}

export interface ClaimValueV12Input {
  claimId?: string;
  notes?: readonly ReferrerNote[];
  config?: ClaimValueV12Config;
}

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
  jobDates?: JobDateFields;
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

export function claimValueV12ConfigHash(config: ClaimValueV12Config): string {
  return hashInputs({
    kind: config.kind,
    version: config.version,
    curvePower: config.curvePower,
    maxLevel: config.maxLevel,
    role: config.role,
    backing: config.backing,
    companyEvidenceConfigHash: config.companyEvidenceConfigHash,
    companySeedHash: config.companySeedHash,
  });
}

export function claimValueV12ConfigId(config: ClaimValueV12Config): string {
  return `${config.kind}@${config.version}:${claimValueV12ConfigHash(config).slice(0, 8)}`;
}

export function scoreClaimValue(
  claim: ClaimValueSubject,
  evidenceTier: EvidenceTier,
  config: ClaimValueConfig = CLAIM_VALUE_V1_1_0,
): ClaimValueScore {
  assertConfig(config);
  const curved = classOf(claim, config);
  const ownershipMultiplier = ownershipOf(claim.ownership, config);
  const backingMultiplier = backingOf(evidenceTier, config.backing);
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

export function scoreClaimValueV12(
  claim: ClaimValueV12Subject,
  evidenceTier: EvidenceTier,
  input: ClaimValueV12Input = {},
): ClaimValueV12Score {
  const config = input.config ?? CLAIM_VALUE_V1_2_0;
  assertCurve(config);
  const curved = classOfV12(claim, config);
  const roleMultiplier = claim.claimClass === "selection" ? 1 : roleOf(claim.role, config);
  const backingMultiplier = backingOf(effectiveTier(evidenceTier, input), config.backing);
  const raw = curved.classValue * roleMultiplier * backingMultiplier;
  if (!Number.isFinite(raw)) {
    throw new Error("claim value: product is not a finite number");
  }
  return {
    configId: claimValueV12ConfigId(config),
    configVersion: config.version,
    configHash: claimValueV12ConfigHash(config),
    claimClass: claim.claimClass,
    curved: curved.curved,
    classValue: curved.classValue,
    roleMultiplier,
    backingMultiplier,
    claimValue: clampUnit(raw),
  };
}

/** A 0–4 rubric level on the 0–10 display scale. */
export function displayLevel(level: number): number {
  return level * 2.5;
}

/** A claim value in [0, 1] on the 0–10 display scale. */
export function displayClaimValue(claimValue: number): number {
  return claimValue * 10;
}

/**
 * Accepted claims become outcomes. A selection is an outcome whose `value`
 * is its claim value. Review claims are left out. No opportunity is written.
 *
 * These outcomes can become V2 judge-calibration truth labels, so `claimValue`
 * must be scored without referrer notes: a judge's note must not raise the
 * outcome that judge is graded against.
 */
export function claimValuesToLongitudinalRecords(claims: readonly ValuedClaim[]): {
  outcomes: Outcome[];
  opportunities: [];
} {
  const outcomes: Outcome[] = [];
  for (const claim of claims) {
    if (claim.status !== "accepted") continue;
    if (!Number.isFinite(claim.claimValue)) continue;
    const observedAt = observedAtFromClaim(claim);
    if (observedAt === null) continue;
    outcomes.push({
      id: `outcome-${claim.id}`,
      personId: claim.personId,
      opportunityId: null,
      kind: `career_claim:${claim.claimClass}`,
      value: claim.claimValue,
      observedAt,
      createdAt: new Date(claim.createdAt.getTime()),
    });
  }
  return { outcomes, opportunities: [] };
}

function observedAtFromClaim(claim: ValuedClaim): Date | null {
  if (!claim.jobDates) return new Date(claim.observedAt.getTime());
  const iso = observedAtForJobClaim(claim.claimClass, claim.jobDates);
  if (iso === null) return null;
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
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
  assertCurve(config);
}

function assertCurve(config: { curvePower: number; maxLevel: number }): void {
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

function classOfV12(
  claim: ClaimValueV12Subject,
  config: ClaimValueV12Config,
): Pick<ClaimValueV12Score, "classValue" | "curved"> {
  if (claim.claimClass === "selection") {
    const selectivity = curvedExpectation(
      selectivityAfterCompanyEvidence(claim.selectivity, claim.companyEvidence),
      config,
      "selectivity",
    );
    const poolStrength = curvedExpectation(claim.pool_strength, config, "pool_strength");
    return {
      classValue: Math.sqrt(selectivity * poolStrength),
      curved: { selectivity, poolStrength, difficulty: null, scale: null },
    };
  }
  const difficulty = curvedExpectation(claim.difficulty, config, "difficulty");
  const scale = curvedExpectation(claim.scale, config, "scale");
  return {
    classValue: Math.sqrt(difficulty * scale),
    curved: { selectivity: null, poolStrength: null, difficulty, scale },
  };
}

/**
 * Selectivity distribution before `curvedExpectation`.
 *
 * Integer step. Each atom `k` moves to `applyProxyLift(k, evidence, COMPANY_EVIDENCE_CONFIG)`.
 * That call is SEA-45's rule. A known rate is the identity. Otherwise the level
 * rises by at most `proxyLiftCap` (1) and stops at `maxProxyLevel` (3), so a
 * proxy never writes level 4. A mass already at 4 stays at 4. The ceiling does
 * not pull a text-only level 4 down.
 *
 * Bonus step. `joinedEarly` is not read. `b` is `earlyJoinerBonus` clamped to
 * `[0, earlyJoinerBonusMax]` (0.25). At `b === 0` the lifted distribution is
 * unchanged, so the default bonus and a `joined_early` flag do not move value.
 * When `b > 0`, each atom at `L < 4` splits. Weight `1 - b` stays at `L` and
 * weight `b` moves to `L + 1`. An atom at 4 stays at 4. A bonus above the cap
 * is the cap. This can place at most `b` of a level-3 atom on level 4. The
 * integer proxy step still cannot put an atom on level 4.
 *
 * `companyEvidence === null` skips both steps.
 */
function selectivityAfterCompanyEvidence(
  distribution: LevelDistributionV12,
  evidence: CompanySelectionEvidence | null,
): LevelDistributionV12 {
  if (evidence === null) return distribution;
  const lifted = [0, 0, 0, 0, 0];
  for (let level = 0; level <= 4; level++) {
    const probability = distribution.probabilities[level];
    if (typeof probability !== "number" || !Number.isFinite(probability)) {
      throw new Error(`claim value: selectivity probability at level ${level} is not finite`);
    }
    const dest = applyProxyLift(level, evidence, COMPANY_EVIDENCE_CONFIG);
    lifted[dest] = (lifted[dest] ?? 0) + probability;
  }
  const bonus = clampedEarlyBonus(evidence.earlyJoinerBonus);
  const shifted = bonus === 0 ? lifted : splitBonus(lifted, bonus);
  return {
    score: distribution.score,
    confidence: distribution.confidence,
    probabilities: [
      shifted[0] ?? 0,
      shifted[1] ?? 0,
      shifted[2] ?? 0,
      shifted[3] ?? 0,
      shifted[4] ?? 0,
    ],
  };
}

function splitBonus(lifted: number[], bonus: number): number[] {
  const shifted = [0, 0, 0, 0, 0];
  for (let level = 0; level <= 4; level++) {
    const probability = lifted[level] ?? 0;
    if (level === 4) {
      shifted[4] = (shifted[4] ?? 0) + probability;
      continue;
    }
    shifted[level] = (shifted[level] ?? 0) + (1 - bonus) * probability;
    shifted[level + 1] = (shifted[level + 1] ?? 0) + bonus * probability;
  }
  return shifted;
}

function clampedEarlyBonus(bonus: number): number {
  if (!Number.isFinite(bonus) || bonus <= 0) return 0;
  const cap = COMPANY_EVIDENCE_CONFIG.earlyJoinerBonusMax;
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  return Math.min(bonus, cap);
}

function curvedExpectation(
  distribution: LevelDistribution | LevelDistributionV12,
  config: { curvePower: number; maxLevel: number },
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

function roleOf(role: RoleDistribution | null, config: ClaimValueV12Config): number {
  if (role === null) return finiteWeight(config.role.major_contributor, "role fallback");
  const multiplier =
    role.probabilities.original_author * config.role.original_author +
    role.probabilities.major_contributor * config.role.major_contributor +
    role.probabilities.maintainer * config.role.maintainer +
    role.probabilities.minor_part * config.role.minor_part;
  return finiteWeight(multiplier, "role multiplier");
}

function effectiveTier(tier: EvidenceTier, input: ClaimValueV12Input): EvidenceTier {
  if (tier === "externally_verified") return tier;
  const claimId = input.claimId;
  const notes = input.notes;
  if (claimId === undefined || notes === undefined) return tier;
  const named = notes.some((note) => note.claimId === claimId && note.referrerName.trim() !== "");
  if (!named || tier !== "self_reported") return tier;
  return "corroborated";
}

function backingOf(tier: EvidenceTier, backing: Record<EvidenceTier, number>): number {
  return finiteWeight(backing[tier], `backing.${String(tier)}`);
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
