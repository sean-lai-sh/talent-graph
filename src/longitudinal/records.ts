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
 * `IdentityAssessment` and `ClaimAssessment` are pure projections of it (see
 * `./projections.ts`). A repeated run, or a rubric whose *thresholds* moved,
 * re-derives from stored records with no network at all.
 *
 * This module is the record's shape and its address. Where records are kept is
 * `./store.ts`; what they project to is `./projections.ts`. All three are pure
 * and runtime-agnostic: no SDK, no fetch, no clock.
 */

import { CAREER_EVIDENCE_DIMENSIONS } from "./dimensions.ts";
import { contentFingerprint } from "./provenance.ts";
import type { GrokEvidenceItem } from "./types.ts";

/**
 * A judgment invariant was broken: a record that is not what it claims to be,
 * an answer that cannot be read under this rubric, a value the pipeline
 * cannot represent.
 *
 * Its own class because the fan-out has to tell two failures apart. A
 * judgment that could not be *made* — the host is down, the request timed
 * out, `fetch` threw — is an unavailable judgment, and one item's problem: it
 * becomes a `review` claim and the batch carries on. A broken invariant is a
 * bug in this code, in a store or in a service, and no amount of retrying
 * fixes it; it is raised to the caller whatever `onItemError` says, because a
 * plausible-looking `review` claim would hide it.
 *
 * It extends `TypeError` — what these throws have always been — so nothing
 * that catches or asserts on `TypeError` changes meaning. What changed is
 * that the pipeline decides by *class*, not by shape: `fetch` reports a
 * connection failure as a plain `TypeError`, and a common outage must not
 * read as a broken invariant.
 */
export class JudgmentInvariantError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "JudgmentInvariantError";
  }
}

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

/** The identity question names, in the order the adapter sends them. */
export const IDENTITY_ANSWER_KEYS = [
  "decision",
  "same_name",
  "same_affiliation",
  "same_handle",
] as const;

/** The claim question names, in the order the adapter sends them. */
export const CLAIM_ANSWER_KEYS = ["event_kind", ...CAREER_EVIDENCE_DIMENSIONS] as const;

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
