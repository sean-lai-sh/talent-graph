/**
 * Evidence-only substance: a candidate score no judge can move. Movement
 * settles a judge's bet, so claim values are recomputed from the raw Jev
 * judgment with no referrer notes (they lift `scoreClaimValueV12`), never read
 * from a stored number, and there is no `trend` input.
 */

import { deepFreeze } from "../models/freeze.ts";
import { hashInputs, stableStringify } from "../provenance/hash.ts";
import type { JobDateFields } from "./claimPreprocess.ts";
import type { LevelDistribution, RoleDistribution } from "./claimRubricV12.ts";
import {
  CLAIM_VALUE_V1_2_0,
  type ClaimValueV12Config,
  type ClaimValueV12Subject,
  claimValueV12ConfigHash,
  type EvidenceTier,
  scoreClaimValueV12,
} from "./claimValue.ts";
import type { CompanySelectionEvidence } from "./companyEvidence.ts";
import {
  PERSON_ROLLUP,
  type PersonRollupConfig,
  personRollupHash,
  personRollups,
  type RollupClaim,
  type RollupClaimStatus,
} from "./personRollup.ts";
import { inRange, unit } from "./ranges.ts";
import {
  type JevAnswer,
  type JevChoiceAnswer,
  type JevJudgmentRecord,
  type JevRawScoreAnswer,
  JudgmentInvariantError,
  recordFields,
} from "./records.ts";
import type { ClaimAuthor, SourceKind } from "./types.ts";
import { validateClaimAuthor } from "./validate.ts";

export interface OutputOnlyRollupConfig {
  kind: "output_only_rollup";
  version: "1.0.0";
  /** Lower bound on `substance`. */
  sFloor: number;
  /** Fewer accepted output claims than this at the cutoff marks the result thin. */
  minOutputClaims: number;
  claimValue: ClaimValueV12Config;
  personRollup: PersonRollupConfig;
}

export const OUTPUT_ONLY_ROLLUP_V1_0_0: OutputOnlyRollupConfig = deepFreeze({
  kind: "output_only_rollup",
  version: "1.0.0",
  sFloor: 0.3,
  minOutputClaims: 3,
  claimValue: CLAIM_VALUE_V1_2_0,
  personRollup: PERSON_ROLLUP,
});

export interface OutputOnlyClaim {
  id: string;
  personId: string;
  recordId: string;
  claimClass: "selection" | "output";
  status: RollupClaimStatus;
  source: SourceKind;
  author?: ClaimAuthor;
  evidenceTier: EvidenceTier;
  jobDates: JobDateFields;
  /** Selection claims only. `null` skips the company-evidence lift. */
  companyEvidence: CompanySelectionEvidence | null;
}

export interface OutputOnlyRollupInput {
  personId: string;
  records: readonly JevJudgmentRecord[];
  claims: readonly OutputOnlyClaim[];
  /** Claims whose evidence date is after this instant are left out. */
  evidenceCutoff: Date;
  config?: OutputOnlyRollupConfig;
}

export interface OutputOnlyRollup {
  /** Top-N mean of accepted output claim values, never below `sFloor`. */
  substance: number;
  /** Top-N mean of accepted selection claim values; `null` when there are none. */
  selection: number | null;
  /** Too few output claims, or substance raised to `sFloor`. Thin is not missing. */
  thin: boolean;
  claimCount: number;
  inputHash: string;
  configHash: string;
}

/** career_evidence 1.2 spec ids (`version:rubric hash`) whose records this roll-up accepts. */
export const OUTPUT_ONLY_ACCEPTED_SPEC_IDS: ReadonlySet<string> = new Set([
  "career_evidence@1.2.0:cd500b05",
  "career_evidence@1.2.1:8170c38a",
  "career_evidence@1.2.2:b644c4c3",
  "career_evidence@1.2.3:8119ac21",
  "career_evidence@1.2.4:fafb7d39",
]);

const EVIDENCE_ONLY_TIERS: ReadonlySet<EvidenceTier> = new Set([
  "self_reported",
  "externally_verified",
]);

export function outputOnlyRollupConfigHash(
  config: OutputOnlyRollupConfig = OUTPUT_ONLY_ROLLUP_V1_0_0,
): string {
  return hashInputs({
    kind: config.kind,
    version: config.version,
    sFloor: config.sFloor,
    minOutputClaims: config.minOutputClaims,
    claimValueConfigHash: claimValueV12ConfigHash(config.claimValue),
    personRollupHash: personRollupHash(config.personRollup),
  });
}

/**
 * When a claim's evidence became observable: selection and ongoing output from
 * the role's start, finished output from its end. `null` if the date is
 * missing or not a calendar date. Differs from `observedAtForJobClaim`, which
 * dates ongoing output by `publishedAt`.
 */
export function evidenceDateFor(claim: {
  claimClass: "selection" | "output";
  jobDates: JobDateFields;
}): Date | null {
  const { startedAt, endedAt } = claim.jobDates;
  if (claim.claimClass === "selection") return calendarDate(startedAt);
  return calendarDate(endedAt ?? startedAt);
}

export function outputOnlyRollup(input: OutputOnlyRollupInput): OutputOnlyRollup {
  const config = input.config ?? OUTPUT_ONLY_ROLLUP_V1_0_0;
  assertConfig(config);
  const cutoff = input.evidenceCutoff;
  if (!(cutoff instanceof Date) || !Number.isFinite(cutoff.getTime())) {
    throw new Error("output-only roll-up: evidenceCutoff must be a valid instant");
  }
  const records = recordsById(input.records);
  const claims = [...input.claims].sort((a, b) => compareIds(a.id, b.id));
  const hashed: {
    claim: Required<OutputOnlyClaim>;
    record: Readonly<Record<string, unknown>> | null;
  }[] = [];
  const counted: RollupClaim[] = [];
  let outputCount = 0;
  let previousId: string | null = null;
  const claimByRecord = new Map<string, string>();

  for (const claim of claims) {
    if (claim.id === previousId) {
      throw new Error(`output-only roll-up: duplicate claim id "${claim.id}"`);
    }
    previousId = claim.id;
    if (claim.personId !== input.personId) {
      throw new Error(
        `output-only roll-up: claim ${claim.id} is ${claim.personId}'s, not ${input.personId}'s`,
      );
    }
    const author = validateClaimAuthor({ author: claim.author, source: claim.source });
    if (!author.ok) {
      throw new Error(`output-only roll-up: claim ${claim.id}: ${author.errors.join("; ")}`);
    }
    if (!EVIDENCE_ONLY_TIERS.has(claim.evidenceTier)) {
      throw new JudgmentInvariantError(
        `output-only roll-up: claim ${claim.id} has evidence tier "${claim.evidenceTier}"; only ${[...EVIDENCE_ONLY_TIERS].join(" and ")} are accepted, since a referrer note is what raises self_reported to corroborated`,
      );
    }
    if (claim.status !== "accepted") {
      hashed.push({ claim: hashedFields(claim), record: null });
      continue;
    }
    const record = recordFor(claim, records);
    const firstClaim = claimByRecord.get(record.id);
    if (firstClaim !== undefined) {
      throw new JudgmentInvariantError(
        `output-only roll-up: record ${record.id} backs more than one claim (${firstClaim}, ${claim.id})`,
      );
    }
    claimByRecord.set(record.id, claim.id);
    hashed.push({ claim: hashedFields(claim), record: recordFields(record) });

    const evidenceDate = evidenceDateFor(claim);
    if (evidenceDate === null || evidenceDate.getTime() > cutoff.getTime()) continue;
    const scored = scoreClaimValueV12(subjectOf(claim, record), claim.evidenceTier, {
      config: config.claimValue,
    });
    counted.push({
      id: claim.id,
      personId: claim.personId,
      claimClass: claim.claimClass,
      claimValue: scored.claimValue,
      status: "accepted",
      observedAt: evidenceDate,
    });
    if (claim.claimClass === "output") outputCount += 1;
  }

  const row =
    counted.length === 0
      ? undefined
      : personRollups({ claims: counted, config: config.personRollup }).get(input.personId);
  const measured = row?.substance ?? null;
  const thin =
    outputCount < config.minOutputClaims || measured === null || measured < config.sFloor;
  return {
    substance: Math.max(measured ?? config.sFloor, config.sFloor),
    selection: row && row.selectionClaimIds.length > 0 ? row.selectionAggregate : null,
    thin,
    claimCount: counted.length,
    inputHash: hashInputs({
      personId: input.personId,
      evidenceCutoff: cutoff,
      claims: hashed,
    }),
    configHash: outputOnlyRollupConfigHash(config),
  };
}

function hashedFields(claim: OutputOnlyClaim): Required<OutputOnlyClaim> {
  return {
    id: claim.id,
    personId: claim.personId,
    recordId: claim.recordId,
    claimClass: claim.claimClass,
    status: claim.status,
    source: claim.source,
    author: claim.author ?? "candidate",
    evidenceTier: claim.evidenceTier,
    jobDates: {
      startedAt: claim.jobDates.startedAt,
      endedAt: claim.jobDates.endedAt,
      publishedAt: claim.jobDates.publishedAt,
    },
    companyEvidence: claim.companyEvidence,
  };
}

function assertConfig(config: OutputOnlyRollupConfig): void {
  if (!Number.isFinite(config.sFloor) || config.sFloor < 0 || config.sFloor > 1) {
    throw new Error(`output-only roll-up: sFloor must be in [0, 1] (got ${config.sFloor})`);
  }
  if (!Number.isInteger(config.minOutputClaims) || config.minOutputClaims < 0) {
    throw new Error(
      `output-only roll-up: minOutputClaims must be a non-negative integer (got ${config.minOutputClaims})`,
    );
  }
}

function recordsById(records: readonly JevJudgmentRecord[]): Map<string, JevJudgmentRecord> {
  const byId = new Map<string, JevJudgmentRecord>();
  for (const record of records) {
    const seen = byId.get(record.id);
    if (seen && stableStringify(recordFields(seen)) !== stableStringify(recordFields(record))) {
      throw new JudgmentInvariantError(
        `output-only roll-up: two different records share id ${record.id}`,
      );
    }
    byId.set(record.id, record);
  }
  return byId;
}

function recordFor(
  claim: OutputOnlyClaim,
  records: ReadonlyMap<string, JevJudgmentRecord>,
): JevJudgmentRecord {
  const record = records.get(claim.recordId);
  if (!record) {
    throw new Error(
      `output-only roll-up: claim ${claim.id} names missing record ${claim.recordId}`,
    );
  }
  if (record.kind !== "claim") {
    throw new JudgmentInvariantError(
      `output-only roll-up: record ${record.id} is a ${record.kind} record, not a claim one`,
    );
  }
  if (record.personId !== claim.personId) {
    throw new JudgmentInvariantError(
      `output-only roll-up: record ${record.id} is ${record.personId}'s, not ${claim.personId}'s`,
    );
  }
  if (!OUTPUT_ONLY_ACCEPTED_SPEC_IDS.has(record.specId)) {
    throw new JudgmentInvariantError(
      `output-only roll-up: record ${record.id} was judged under ${record.specId}, not an accepted career_evidence 1.2 rubric`,
    );
  }
  return record;
}

function subjectOf(claim: OutputOnlyClaim, record: JevJudgmentRecord): ClaimValueV12Subject {
  const what = `output-only roll-up: record ${record.id}`;
  if (claim.claimClass === "selection") {
    return {
      claimClass: "selection",
      selectivity: levelAnswer(record.answers.selectivity, `${what} selectivity`),
      pool_strength: levelAnswer(record.answers.pool_strength, `${what} pool_strength`),
      companyEvidence: claim.companyEvidence,
    };
  }
  return {
    claimClass: "output",
    difficulty: levelAnswer(record.answers.difficulty, `${what} difficulty`),
    scale: levelAnswer(record.answers.scale, `${what} scale`),
    role: roleAnswer(record.answers.role, `${what} role`),
  };
}

function levelAnswer(answer: JevAnswer | undefined, what: string): LevelDistribution {
  const raw = answer as JevRawScoreAnswer | undefined;
  if (raw === undefined || typeof raw.score !== "number" || !Array.isArray(raw.probabilities)) {
    throw new JudgmentInvariantError(`${what} must be a score answer`);
  }
  if (raw.probabilities.length !== 5) {
    throw new JudgmentInvariantError(
      `${what}.probabilities has ${raw.probabilities.length} entries; levels 0..4 need 5`,
    );
  }
  const [p0, p1, p2, p3, p4] = raw.probabilities.map((value, level) =>
    unit(value, `${what}.probabilities[${level}]`),
  ) as [number, number, number, number, number];
  return {
    score: inRange(raw.score, 0, 4, `${what}.score`),
    confidence: unit(raw.confidence, `${what}.confidence`),
    probabilities: [p0, p1, p2, p3, p4],
  };
}

const ROLE_CHOICES = ["original_author", "major_contributor", "maintainer", "minor_part"] as const;

function roleAnswer(answer: JevAnswer | undefined, what: string): RoleDistribution {
  const raw = answer as JevChoiceAnswer | undefined;
  if (
    raw === undefined ||
    typeof raw.choice !== "string" ||
    typeof raw.probabilities !== "object"
  ) {
    throw new JudgmentInvariantError(`${what} must be a choice answer`);
  }
  const choice = ROLE_CHOICES.find((role) => role === raw.choice);
  if (choice === undefined) {
    throw new JudgmentInvariantError(`${what}.choice "${raw.choice}" is not a role`);
  }
  const probability = (role: (typeof ROLE_CHOICES)[number]) =>
    unit(raw.probabilities[role], `${what}.probabilities.${role}`);
  return {
    choice,
    confidence: unit(raw.confidence, `${what}.confidence`),
    probabilities: {
      original_author: probability("original_author"),
      major_contributor: probability("major_contributor"),
      maintainer: probability("maintainer"),
      minor_part: probability("minor_part"),
    },
  };
}

function calendarDate(value: string | null): Date | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  // `Date` rolls 2025-02-30 over to March 2, so require a round trip.
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
