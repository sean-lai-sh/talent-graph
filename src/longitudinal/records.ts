/**
 * Judgment records: the raw observation of the evidence pipeline.
 *
 * Everywhere else in the engine an immutable observation goes in and a pure
 * derivation comes out, with a `ModelRun` wrapping the derivation. The Jev
 * judgments were the exception: the HTTP call *was* the observation, and
 * everything the model reported beyond a rounded score and a decision — the
 * model that actually answered, token usage, the request id, the per-level
 * probabilities and the rubric the model says it used — was dropped on the
 * floor. Re-deriving anything therefore meant paying for the same answers
 * again.
 *
 * A `JevJudgmentRecord` is that observation, written once and never rewritten:
 * `IdentityAssessment` and `ClaimAssessment` are pure projections of it. A
 * repeated run, or a rubric whose *thresholds* moved, re-derives from stored
 * records with no network at all.
 *
 * This module is pure and runtime-agnostic: no SDK, no fetch, no clock.
 */

import { deepFreeze } from "../models/freeze.ts";
import type { CareerEvidenceSpec } from "../models/spec.ts";
import { CAREER_EVIDENCE_DIMENSIONS } from "./dimensions.ts";
import type { ClaimAssessment, IdentityAssessment } from "./judgments.ts";
import { contentFingerprint } from "./provenance.ts";
import type {
  CareerEventKind,
  DimensionJudgment,
  GrokEvidenceItem,
  IdentityDecision,
  ProgressDimension,
} from "./types.ts";
import { CAREER_EVENT_KINDS } from "./types.ts";

/** What a score question really answered, before any derivation. */
export interface JevRawScoreAnswer {
  /** Expected score, which may fall between rubric levels. Never rounded. */
  score: number;
  confidence: number;
  /** Indexed by rubric level, read off `spec.levels` — never key order. */
  probabilities: number[];
  /** The level text the model reports having used, for drift detection. */
  legend: string[];
}

/** What a yes/no question answered. */
export interface JevNoulAnswer {
  noul: number;
}

/** What a choice question answered, with its full probability map. */
export interface JevChoiceAnswer {
  choice: string;
  confidence: number;
  /** Keyed by label, as the labels were sent. */
  probabilities: Record<string, number>;
}

export type JevAnswer = JevRawScoreAnswer | JevNoulAnswer | JevChoiceAnswer;

/**
 * One request to the judgment model and everything it answered.
 *
 * Append-only: a record is frozen when it is written, and a second write of
 * the same `requestFingerprint` with different content is an error, not an
 * update. The fingerprint is the cache key; the id is derived from it, so two
 * identical requests name the same observation.
 */
export interface JevJudgmentRecord {
  /** `jev-${requestFingerprint}`. */
  id: string;
  kind: "identity" | "claim";
  personId: string;
  /** `personId | sourceId | publishedAt | contentHash`. */
  evidenceKey: string;
  /** `contentFingerprint(state + questions + specId)` — the cache key. */
  requestFingerprint: string;
  /** `career_evidence@<version>:<rubricHash>`. */
  specId: string;
  /** The model the spec asked for. */
  requestedModel: string;
  /** The model that answered, verbatim. Never normalised to the requested one. */
  respondedModel: string;
  /** `x-typesafe-request-id`, or `null` when the response carried none. */
  requestId: string | null;
  /** Keyed by question name, exactly as the questions were sent. */
  answers: Record<string, JevAnswer>;
  usage: { inputTokens: number; outputTokens: number };
  /** When the answer was observed. Append-only; never rewritten. */
  observedAt: Date;
}

/**
 * Where judgment records are kept. The in-memory implementation below is the
 * reference; a durable one has the same two methods and the same append-only
 * rule.
 */
export interface JevJudgmentStore {
  get(requestFingerprint: string): Promise<JevJudgmentRecord | null>;
  put(record: JevJudgmentRecord): Promise<void>;
}

/** The identity question names, in the order the adapter sends them. */
export const IDENTITY_ANSWER_KEYS = [
  "decision",
  "same_name",
  "same_affiliation",
  "same_handle",
] as const;

/** The claim question names, in the order the adapter sends them. */
export const CLAIM_ANSWER_KEYS = ["event_kind", ...CAREER_EVIDENCE_DIMENSIONS] as const;

/** The field-match questions, by the identity field each one answers. */
const IDENTITY_FIELD_ANSWER_KEYS = {
  name: "same_name",
  affiliation: "same_affiliation",
  handle: "same_handle",
} as const;

const IDENTITY_DECISIONS: readonly IdentityDecision[] = ["same", "review", "different"];

/** The choice label the taxonomy uses for "no event is established". */
export const NO_SUPPORTED_EVENT = "no_supported_event";

/**
 * The evidence one record is about: person plus the source item's identity.
 * Not the cache key — two spec versions asking about the same evidence share
 * this and differ in `requestFingerprint`.
 */
export function evidenceKeyFor(personId: string, evidence: GrokEvidenceItem): string {
  return [personId, evidence.sourceId, evidence.publishedAt, evidence.contentHash].join("|");
}

/**
 * Freeze a record deeply and detach its `observedAt` from the caller.
 *
 * `Object.freeze` does not stop `setTime`, so the Date is copied rather than
 * shared: a frozen record whose timestamp a caller could still move is not
 * append-only.
 */
export function freezeRecord(record: JevJudgmentRecord): JevJudgmentRecord {
  return deepFreeze({ ...record, observedAt: new Date(record.observedAt.getTime()) });
}

/** The exact content of a record, for the append-only comparison. */
function recordContent(record: JevJudgmentRecord): string {
  return JSON.stringify({
    id: record.id,
    kind: record.kind,
    personId: record.personId,
    evidenceKey: record.evidenceKey,
    requestFingerprint: record.requestFingerprint,
    specId: record.specId,
    requestedModel: record.requestedModel,
    respondedModel: record.respondedModel,
    requestId: record.requestId,
    answers: record.answers,
    usage: record.usage,
    observedAt: record.observedAt.toISOString(),
  });
}

/**
 * The reference store: a `Map`, an append-only `put`, and frozen records.
 *
 * A second `put` of the same fingerprint with identical content is a no-op — a
 * retried write is not a rewrite — and with different content it throws, so a
 * record can never be silently replaced by a later, different answer.
 */
export class InMemoryJevJudgmentStore implements JevJudgmentStore {
  readonly #records = new Map<string, JevJudgmentRecord>();

  async get(requestFingerprint: string): Promise<JevJudgmentRecord | null> {
    return this.#records.get(requestFingerprint) ?? null;
  }

  async put(record: JevJudgmentRecord): Promise<void> {
    const frozen = freezeRecord(record);
    const existing = this.#records.get(frozen.requestFingerprint);
    if (existing !== undefined) {
      if (recordContent(existing) === recordContent(frozen)) return;
      throw new Error(
        `JevJudgmentStore: ${frozen.requestFingerprint} is already recorded with different ` +
          "content; judgment records are append-only",
      );
    }
    this.#records.set(frozen.requestFingerprint, frozen);
  }

  /** Every record held, in insertion order. For inspection and tests. */
  values(): JevJudgmentRecord[] {
    return [...this.#records.values()];
  }

  get size(): number {
    return this.#records.size;
  }
}

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
    throw new TypeError(
      `${what}: record ${record.id} does not answer this spec's questions` +
        (missing.length > 0 ? `; missing ${missing.join(", ")}` : "") +
        (unknown.length > 0 ? `; unknown ${unknown.join(", ")}` : ""),
    );
  }
}

function assertKind(record: JevJudgmentRecord, kind: JevJudgmentRecord["kind"]): void {
  if (record.kind !== kind) {
    throw new TypeError(
      `project${kind === "identity" ? "Identity" : "Claim"}: record ${record.id} is a ` +
        `${record.kind} record, not a ${kind} one`,
    );
  }
}

function finite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${what} must be a finite number (got ${String(value)})`);
  }
  return value;
}

function choiceAnswer(answer: JevAnswer | undefined, what: string): JevChoiceAnswer {
  if (answer === undefined || typeof (answer as JevChoiceAnswer).choice !== "string") {
    throw new TypeError(`${what} must be a choice answer`);
  }
  const choice = answer as JevChoiceAnswer;
  finite(choice.confidence, `${what}.confidence`);
  return choice;
}

function noulAnswer(answer: JevAnswer | undefined, what: string): number {
  if (answer === undefined || typeof (answer as JevNoulAnswer).noul !== "number") {
    throw new TypeError(`${what} must be a noul answer`);
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
    throw new TypeError(`${what} must be a score answer`);
  }
  finite(raw.score, `${what}.score`);
  finite(raw.confidence, `${what}.confidence`);
  if (raw.probabilities.length !== levels.length) {
    throw new TypeError(
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
    throw new TypeError(
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
  assertAnswerKeys(record, CLAIM_ANSWER_KEYS, "projectClaim");
  const event = choiceAnswer(record.answers.event_kind, "projectClaim: event_kind");
  const known: readonly string[] = [...CAREER_EVENT_KINDS, NO_SUPPORTED_EVENT];
  if (!known.includes(event.choice)) {
    throw new TypeError(`projectClaim: "${event.choice}" is not an event kind in this taxonomy`);
  }
  const dimensions: DimensionJudgment[] = CAREER_EVIDENCE_DIMENSIONS.map(
    (dimension: ProgressDimension) => {
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
    },
  );
  return {
    eventKind: event.choice === NO_SUPPORTED_EVENT ? null : (event.choice as CareerEventKind),
    eventConfidence: event.confidence,
    dimensions,
  };
}

/** The cache key for one request: the state and questions sent, under a spec. */
export function requestFingerprint(input: {
  state: unknown;
  questions: unknown;
  specId: string;
}): string {
  return contentFingerprint({
    state: input.state,
    questions: input.questions,
    specId: input.specId,
  });
}

/** `jev-${requestFingerprint}` — one observation, named by the request. */
export function recordIdFor(fingerprint: string): string {
  return `jev-${fingerprint}`;
}
