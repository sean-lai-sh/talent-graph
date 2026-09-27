/**
 * Constructing a judgment client, and the client surface the adapter needs.
 *
 * Resilience is split in two: *transport* policy — how long one attempt may
 * take, and which failures are worth another attempt — belongs here, at the
 * client, and *fan-out* shape — the concurrency cap, per-item isolation and
 * cancellation — belongs to the pipeline (`EvidenceRuntime`). Nothing in
 * `src/` constructs a client or sets a timeout, so the two never drift into
 * one knob.
 *
 * Server-side only: the API key comes from the caller (or the SDK's own
 * environment fallback) in the app layer, never from a browser bundle.
 */

import { choice, noul, score, TypeSafeClient, type TypeSafeClientConfig } from "@typesafe-ai/sdk";
import { claimRubricQuestions } from "../../../../src/longitudinal/claimRubricV11.ts";
import { claimRubricCatalog } from "../../../../src/longitudinal/claimRubricV12.ts";
import type {
  CareerEvidenceSpec,
  CareerEvidenceV11Spec,
  CareerEvidenceV12Spec,
} from "../../../../src/models/spec.ts";

/** One rubric's level text: at least two entries, index = level. */
export type ScoreLevels = readonly [string, string, ...string[]];

/**
 * The transport policy every judgment client starts from.
 *
 * Resilience is split in two: *transport* policy — how long one attempt may
 * take, and which failures are worth another attempt — belongs to the client,
 * and *fan-out* shape — the concurrency cap, per-item isolation and
 * cancellation — belongs to the pipeline (`EvidenceRuntime`). Nothing in
 * `src/` constructs a client or sets a timeout, so the two never drift into
 * one knob.
 *
 * The numbers: a judgment is a single model call, so 30s is generous for one
 * attempt and still bounded; two retries is the SDK's own default, which with
 * `Retry-After` honoured covers a rate-limited window without hammering it. A
 * request the pipeline has abandoned is cancelled by the caller's
 * `AbortSignal`, which stops pending retries too, so retrying cannot outlive
 * the batch that asked for it.
 */
export const JEV_CLIENT_DEFAULTS = Object.freeze({
  timeout: 30_000,
  retry: Object.freeze({ maxRetries: 2, respectRetryAfter: true }),
});

/**
 * A TypeSafe client with this project's transport policy applied.
 *
 * Server-side only: the API key comes from the caller (or the SDK's own
 * environment fallback) in the app layer, never from a browser bundle and
 * never from `src/`. Callers may override any field — an explicit `timeout`
 * or `retry` wins over the defaults above.
 */
export function createJevClient(config: TypeSafeClientConfig = {}): TypeSafeClient {
  return new TypeSafeClient({
    ...JEV_CLIENT_DEFAULTS,
    ...config,
    retry: { ...JEV_CLIENT_DEFAULTS.retry, ...config.retry },
  });
}

/** The identity question set, built from the spec and nothing else. */
export function identityQuestionsFor(spec: CareerEvidenceSpec) {
  const [different, review, same] = spec.questions.identity;
  return {
    decision: choice(spec.questions.identityDecision, { different, review, same }),
    same_name: noul(spec.questions.identityFields.name),
    same_affiliation: noul(spec.questions.identityFields.affiliation),
    same_handle: noul(spec.questions.identityFields.handle),
  };
}

/** The claim question set: the event taxonomy plus one score per dimension. */
export function claimQuestionsFor(spec: CareerEvidenceSpec) {
  return {
    event_kind: choice(spec.questions.eventKind, spec.eventCriteria),
    difficulty: score(spec.questions.dimensions.difficulty, spec.levels.difficulty),
    ownership: score(spec.questions.dimensions.ownership, spec.levels.ownership),
    external_impact: score(spec.questions.dimensions.external_impact, spec.levels.external_impact),
    originality: score(spec.questions.dimensions.originality, spec.levels.originality),
    peer_validation: score(spec.questions.dimensions.peer_validation, spec.levels.peer_validation),
  };
}

export function claimQuestionsV11(spec: CareerEvidenceV11Spec) {
  const questions = claimRubricQuestions(spec);
  return {
    claim_class: choice(questions.claim_class.instructions, questions.claim_class.criteria),
    selectivity: score(questions.selectivity.instructions, questions.selectivity.criteria),
    difficulty: score(questions.difficulty.instructions, questions.difficulty.criteria),
    generalized_impact: score(
      questions.generalized_impact.instructions,
      questions.generalized_impact.criteria,
    ),
    ownership: choice(questions.ownership.instructions, questions.ownership.criteria),
  };
}

export function claimQuestionsV12(spec: CareerEvidenceV12Spec) {
  const questions = claimRubricCatalog(spec);
  return {
    claim_class: choice(questions.claim_class.instructions, questions.claim_class.criteria),
    selectivity: score(questions.selectivity.instructions, questions.selectivity.criteria),
    pool_strength: score(questions.pool_strength.instructions, questions.pool_strength.criteria),
    difficulty: score(questions.difficulty.instructions, questions.difficulty.criteria),
    scale: score(questions.scale.instructions, questions.scale.criteria),
    role: choice(questions.role.instructions, questions.role.criteria),
  };
}

/** The question sets this adapter sends, as types a caller can name. */
export type JevIdentityQuestions = ReturnType<typeof identityQuestionsFor>;
export type JevClaimQuestions = ReturnType<typeof claimQuestionsFor>;
export type JevClaimQuestionsV11 = ReturnType<typeof claimQuestionsV11>;
export type JevClaimQuestionsV12 = ReturnType<typeof claimQuestionsV12>;
