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
 * the same `id` with different content is an error, not an update. The id is
 * the address — the request fingerprint *and* the evidence key (`recordIdFor`)
 * — so the same question asked about the same person's evidence names one
 * observation, and the same question about someone else's names another.
 */
export interface JevJudgmentRecord {
  /**
   * `jev-${requestFingerprint}-${digest of evidenceKey}` — see `recordIdFor`.
   * The request fingerprint alone does not name an observation: the person is
   * never part of a request, so two people asking the same question of the
   * same evidence share a fingerprint and must not share a record.
   */
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
  /**
   * When the answer was observed, as an ISO 8601 instant. Append-only; never
   * rewritten. A string rather than a `Date` because a `Date` stays mutable
   * inside a frozen object — `Object.isFrozen` is true of it while `setTime`
   * still moves the value — and this is also the form a store persists.
   */
  observedAt: string;
}

/**
 * Where judgment records are kept. The in-memory implementation below is the
 * reference; a durable one has the same two methods and the same append-only
 * rule.
 *
 * A record is addressed by its **id**, which carries both the request
 * fingerprint and the evidence key (`recordIdFor`). Addressing by fingerprint
 * alone would serve one person's observation to another, because the person is
 * not part of the request that was sent.
 */
export interface JevJudgmentStore {
  get(recordId: string): Promise<JevJudgmentRecord | null>;
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
 *
 * Half the address (`recordIdFor` is the other half's input): the request
 * fingerprint alone cannot tell two people's judgments apart, because the
 * person is never sent. Two spec versions asking about the same evidence
 * share this key and differ in `requestFingerprint`.
 */
export function evidenceKeyFor(personId: string, evidence: GrokEvidenceItem): string {
  return [personId, evidence.sourceId, evidence.publishedAt, evidence.contentHash].join("|");
}

/**
 * Freeze a record deeply. Nothing inside it can move afterwards: every value
 * it carries is a string, a number or a frozen array or object, so there is no
 * `Date` (or other mutable box) for a holder to reach through.
 */
export function freezeRecord(record: JevJudgmentRecord): JevJudgmentRecord {
  if (typeof record.observedAt !== "string" || Number.isNaN(Date.parse(record.observedAt))) {
    throw new TypeError(
      `freezeRecord: observedAt must be an ISO 8601 instant (got ${String(record.observedAt)})`,
    );
  }
  return deepFreeze({ ...record });
}

/**
 * The exact content of a record, as one string.
 *
 * Used for the append-only comparison, and as what a derivation hashes: a
 * record id names a request, not an answer, so two different answers to the
 * same request must not hash alike.
 */
export function recordContent(record: JevJudgmentRecord): string {
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
    observedAt: record.observedAt,
  });
}

/**
 * The reference store: a `Map` addressed by record id, an append-only `put`,
 * and frozen records.
 *
 * A second `put` of the same id with identical content is a no-op — a retried
 * write is not a rewrite — and with different content it throws, so a record
 * can never be silently replaced by a later, different answer. A record whose
 * id is not its own address is refused outright: written under any other key
 * it would be a record nothing can find.
 */
export class InMemoryJevJudgmentStore implements JevJudgmentStore {
  readonly #records = new Map<string, JevJudgmentRecord>();

  async get(recordId: string): Promise<JevJudgmentRecord | null> {
    return this.#records.get(recordId) ?? null;
  }

  async put(record: JevJudgmentRecord): Promise<void> {
    assertRecordAddress(record);
    const frozen = freezeRecord(record);
    const existing = this.#records.get(frozen.id);
    if (existing !== undefined) {
      if (recordContent(existing) === recordContent(frozen)) return;
      throw new Error(
        `JevJudgmentStore: ${frozen.id} is already recorded with different content; ` +
          "judgment records are append-only",
      );
    }
    this.#records.set(frozen.id, frozen);
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
function assertClaimAnswerKeys(record: JevJudgmentRecord): ProgressDimension[] {
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
    throw new TypeError(
      `projectClaim: record ${record.id} does not answer this spec's questions` +
        (missing.length > 0 ? `; missing ${missing.join(", ")}` : "") +
        (unknown.length > 0 ? `; unknown ${unknown.join(", ")}` : ""),
    );
  }
  return [...judged];
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
  const judged = assertClaimAnswerKeys(record);
  const event = choiceAnswer(record.answers.event_kind, "projectClaim: event_kind");
  const known: readonly string[] = [...CAREER_EVENT_KINDS, NO_SUPPORTED_EVENT];
  if (!known.includes(event.choice)) {
    throw new TypeError(`projectClaim: "${event.choice}" is not an event kind in this taxonomy`);
  }
  // Only the dimensions the record actually answers, in rubric order. A
  // record that carries no dimension answers projects to no judgments — the
  // pipeline's `no_dimensions` review — and never to five zero-score ones.
  const dimensions: DimensionJudgment[] = judged.map((dimension: ProgressDimension) => {
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

/**
 * One observation, named by the request *and* the evidence it was about.
 *
 * The request carries no person: the identity state is the canonical person's
 * name and identities, and the claim state is the evidence alone. Two people
 * with the same name, or the same person's evidence fetched twice under
 * different source ids, therefore produce the same request fingerprint, and a
 * cache addressed by fingerprint alone would hand one person's judgment to the
 * other. The evidence key — `personId | sourceId | publishedAt | contentHash`
 * — is what separates them, so it is part of the id and of the store address.
 */
export function recordIdFor(fingerprint: string, evidenceKey: string): string {
  return `jev-${fingerprint}-${contentFingerprint(evidenceKey).slice(0, 8)}`;
}

/**
 * A record must be stored where a later run will look for it.
 *
 * Every store write goes through here: an id that is not
 * `recordIdFor(requestFingerprint, evidenceKey)` is a record filed under an
 * address nothing computes, which reads back as a permanent cache miss and a
 * re-billed judgment rather than as an error. Loud at the write instead.
 */
export function assertRecordAddress(record: JevJudgmentRecord): void {
  const address = recordIdFor(record.requestFingerprint, record.evidenceKey);
  if (record.id !== address) {
    throw new Error(
      `JevJudgmentStore: record ${record.id} is misfiled; its request fingerprint and evidence ` +
        `key address ${address}`,
    );
  }
}

/**
 * The rubric-hash half of a `career_evidence@<version>:<rubricHash>` spec id.
 *
 * The version may move without changing a single question — a thresholds-only
 * bump — but a different rubric hash means the record answers *different*
 * questions, and nothing may derive from it under this spec.
 */
export function rubricHashOf(specId: string): string {
  const separator = specId.lastIndexOf(":");
  return separator === -1 ? "" : specId.slice(separator + 1);
}
