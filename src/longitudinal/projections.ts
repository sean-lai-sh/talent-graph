/**
 * What a judgment record states, read under a rubric.
 *
 * `projectIdentity` and `projectClaim` are pure: the same record and the same
 * spec always project to the same assessment, with no network and no clock.
 * Everything a record carries that this layer cannot represent — an answer of
 * the wrong shape, a value outside the range its field is defined on — is a
 * broken invariant and is raised, never clamped and never coerced.
 */

import type { CareerEvidenceSpec } from "../models/spec.ts";
import { CAREER_EVIDENCE_DIMENSIONS } from "./dimensions.ts";
import type { ClaimAssessment, IdentityAssessment } from "./judgments.ts";
import type {
  JevAnswer,
  JevChoiceAnswer,
  JevJudgmentRecord,
  JevNoulAnswer,
  JevRawScoreAnswer,
} from "./records.ts";
import {
  CLAIM_ANSWER_KEYS,
  IDENTITY_ANSWER_KEYS,
  JudgmentInvariantError,
  NO_SUPPORTED_EVENT,
} from "./records.ts";
import type {
  CareerEventKind,
  CareerEvidenceDimension,
  DimensionJudgment,
  IdentityDecision,
} from "./types.ts";
import { CAREER_EVENT_KINDS } from "./types.ts";

/** The field-match questions, by the identity field each one answers. */
const IDENTITY_FIELD_ANSWER_KEYS = {
  name: "same_name",
  affiliation: "same_affiliation",
  handle: "same_handle",
} as const;

const IDENTITY_DECISIONS: readonly IdentityDecision[] = ["same", "review", "different"];

/** Reject a record whose answer keys are not exactly the ones asked. */
function assertAnswerKeys(
  record: JevJudgmentRecord,
  expected: readonly string[],
  what: string,
): void {
  const present = new Set(Object.keys(record.answers));
  const missing = expected.filter((key) => !present.has(key));
  const unknown = [...present].filter((key) => !expected.includes(key));
  if (missing.length > 0 || unknown.length > 0) {
    throw new JudgmentInvariantError(
      `${what}: record ${record.id} does not answer this spec's questions` +
        (missing.length > 0 ? `; missing ${missing.join(", ")}` : "") +
        (unknown.length > 0 ? `; unknown ${unknown.join(", ")}` : ""),
    );
  }
}

/**
 * The dimensions a claim record answers, in rubric order.
 *
 * A claim record always answers `event_kind`; the rubric is all-or-nothing.
 * Either the service judged the five dimensions or it judged none of them — a
 * record answering some of them is a partial observation nothing can read, so
 * it is rejected rather than quietly projected with the rest missing. A record
 * with no dimension answers at all is a service that judged no dimension, and
 * projects to no judgments (never to zero-score ones).
 */
function assertClaimAnswerKeys(record: JevJudgmentRecord): CareerEvidenceDimension[] {
  const present = new Set(Object.keys(record.answers));
  const judged = CAREER_EVIDENCE_DIMENSIONS.filter((dimension) => present.has(dimension));
  const unknown = [...present].filter((key) => !CLAIM_ANSWER_KEYS.includes(key as never));
  const missing = [
    ...(present.has("event_kind") ? [] : ["event_kind"]),
    ...(judged.length === 0 || judged.length === CAREER_EVIDENCE_DIMENSIONS.length
      ? []
      : CAREER_EVIDENCE_DIMENSIONS.filter((dimension) => !present.has(dimension))),
  ];
  if (missing.length > 0 || unknown.length > 0) {
    throw new JudgmentInvariantError(
      `projectClaim: record ${record.id} does not answer this spec's questions` +
        (missing.length > 0 ? `; missing ${missing.join(", ")}` : "") +
        (unknown.length > 0 ? `; unknown ${unknown.join(", ")}` : ""),
    );
  }
  return [...judged];
}

function assertKind(record: JevJudgmentRecord, kind: JevJudgmentRecord["kind"]): void {
  if (record.kind !== kind) {
    throw new JudgmentInvariantError(
      `project${kind === "identity" ? "Identity" : "Claim"}: record ${record.id} is a ` +
        `${record.kind} record, not a ${kind} one`,
    );
  }
}

function finite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new JudgmentInvariantError(`${what} must be a finite number (got ${String(value)})`);
  }
  return value;
}

function choiceAnswer(answer: JevAnswer | undefined, what: string): JevChoiceAnswer {
  if (answer === undefined || typeof (answer as JevChoiceAnswer).choice !== "string") {
    throw new JudgmentInvariantError(`${what} must be a choice answer`);
  }
  const choice = answer as JevChoiceAnswer;
  finite(choice.confidence, `${what}.confidence`);
  return choice;
}

function noulAnswer(answer: JevAnswer | undefined, what: string): number {
  if (answer === undefined || typeof (answer as JevNoulAnswer).noul !== "number") {
    throw new JudgmentInvariantError(`${what} must be a noul answer`);
  }
  return finite((answer as JevNoulAnswer).noul, `${what}.noul`);
}

function scoreAnswer(
  answer: JevAnswer | undefined,
  levels: readonly string[],
  what: string,
): JevRawScoreAnswer {
  const raw = answer as JevRawScoreAnswer | undefined;
  if (raw === undefined || typeof raw.score !== "number" || !Array.isArray(raw.probabilities)) {
    throw new JudgmentInvariantError(`${what} must be a score answer`);
  }
  finite(raw.score, `${what}.score`);
  finite(raw.confidence, `${what}.confidence`);
  if (raw.probabilities.length !== levels.length) {
    throw new JudgmentInvariantError(
      `${what}.probabilities has ${raw.probabilities.length} entries; this rubric has ` +
        `${levels.length} levels, and the vector is indexed by level`,
    );
  }
  for (const [index, value] of raw.probabilities.entries()) {
    finite(value, `${what}.probabilities[${index}]`);
  }
  return raw;
}

/**
 * The identity assessment a record states. Pure: the same record and spec
 * always project to the same assessment, with no network and no clock.
 */
export function projectIdentity(
  record: JevJudgmentRecord,
  /** Unused: an identity answer is read off the record alone. Taken for
   *  symmetry with `projectClaim`, so both projections read one way. */
  _spec: CareerEvidenceSpec,
): IdentityAssessment {
  assertKind(record, "identity");
  assertAnswerKeys(record, IDENTITY_ANSWER_KEYS, "projectIdentity");
  const decision = choiceAnswer(record.answers.decision, "projectIdentity: decision");
  if (!IDENTITY_DECISIONS.includes(decision.choice as IdentityDecision)) {
    throw new JudgmentInvariantError(
      `projectIdentity: "${decision.choice}" is not an identity decision ` +
        `(${IDENTITY_DECISIONS.join(", ")})`,
    );
  }
  return {
    decision: decision.choice as IdentityDecision,
    confidence: decision.confidence,
    fieldMatches: {
      name: noulAnswer(record.answers[IDENTITY_FIELD_ANSWER_KEYS.name], "projectIdentity: name"),
      affiliation: noulAnswer(
        record.answers[IDENTITY_FIELD_ANSWER_KEYS.affiliation],
        "projectIdentity: affiliation",
      ),
      handle: noulAnswer(
        record.answers[IDENTITY_FIELD_ANSWER_KEYS.handle],
        "projectIdentity: handle",
      ),
    },
  };
}

/**
 * The claim assessment a record states, read against `spec`.
 *
 * The probability vector is already indexed by rubric level in the record, so
 * the projection checks its length against `spec.levels` rather than trusting
 * key order — the bug this whole layer exists to make impossible.
 */
export function projectClaim(record: JevJudgmentRecord, spec: CareerEvidenceSpec): ClaimAssessment {
  assertKind(record, "claim");
  const judged = assertClaimAnswerKeys(record);
  const event = choiceAnswer(record.answers.event_kind, "projectClaim: event_kind");
  const known: readonly string[] = [...CAREER_EVENT_KINDS, NO_SUPPORTED_EVENT];
  if (!known.includes(event.choice)) {
    throw new JudgmentInvariantError(
      `projectClaim: "${event.choice}" is not an event kind in this taxonomy`,
    );
  }
  // Only the dimensions the record actually answers, in rubric order. A
  // record that carries no dimension answers projects to no judgments — the
  // pipeline's `no_dimensions` review — and never to five zero-score ones.
  const dimensions: DimensionJudgment[] = judged.map((dimension: CareerEvidenceDimension) => {
    const answer = scoreAnswer(
      record.answers[dimension],
      spec.levels[dimension],
      `projectClaim: ${dimension}`,
    );
    return {
      dimension,
      score: answer.score,
      probabilities: [...answer.probabilities],
      confidence: answer.confidence,
    };
  });
  return {
    eventKind: event.choice === NO_SUPPORTED_EVENT ? null : (event.choice as CareerEventKind),
    eventConfidence: event.confidence,
    dimensions,
  };
}
