import {
  choice,
  noul,
  type RequestOptions,
  type ScoreResponse,
  type SystemOneResult,
  score,
  TypeSafeClient,
  type TypeSafeClientConfig,
} from "@typesafe-ai/sdk";
import { CAREER_EVIDENCE_DIMENSIONS } from "../../../../src/longitudinal/dimensions.ts";
import type {
  ClaimAssessment,
  IdentityAssessment,
  JevJudgment,
  JevJudgmentService,
  JevRequestOptions,
} from "../../../../src/longitudinal/judgments.ts";
import type { JevAnswer, JevJudgmentRecord } from "../../../../src/longitudinal/records.ts";
import {
  evidenceKeyFor,
  freezeRecord,
  JudgmentInvariantError,
  projectClaim,
  projectIdentity,
  recordIdFor,
  requestFingerprint,
} from "../../../../src/longitudinal/records.ts";
import type {
  CanonicalIdentity,
  GrokEvidenceItem,
  ProgressDimension,
} from "../../../../src/longitudinal/types.ts";
import {
  CAREER_EVIDENCE_V1_0_0,
  careerEvidenceSpecId,
} from "../../../../src/models/careerEvidence.ts";
import { assertSpec, type CareerEvidenceSpec } from "../../../../src/models/spec.ts";

type ScoreLevels = readonly [string, string, ...string[]];

/**
 * Rubric text for each dimension: one entry per point on the shared
 * 0..MAX_LEVEL scale. The text lives in the registered spec, not here — this
 * is the registered rubric, re-exported for the callers that read it.
 */
export const LEVELS: Record<ProgressDimension, ScoreLevels> = CAREER_EVIDENCE_V1_0_0.levels;

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

/**
 * Server-side TypeSafe/Jev adapter. Keep the API key out of browser bundles.
 *
 * Every question below is built from `spec`: the instruction text, the
 * identity criteria, the event taxonomy and the rubric levels. Nothing the
 * model is asked is written here, so a judgment stamped with a spec version
 * can be reproduced from that version alone.
 *
 * What comes back is written down whole. `withResponse()` carries the request
 * id alongside the parsed body, and the body carries the model that actually
 * answered and the token usage; the per-question answers keep their un-rounded
 * expected scores, their full probability vectors and the legend the model
 * reports having used. That `JevJudgmentRecord` is the observation, and the
 * `IdentityAssessment`/`ClaimAssessment` returned with it are
 * `projectIdentity`/`projectClaim` of that record — nothing is derived here
 * that a later derivation from the same record could disagree with.
 */
export function createJevJudgmentService(
  client: TypeSafeClient,
  spec: CareerEvidenceSpec = CAREER_EVIDENCE_V1_0_0,
): JevJudgmentService {
  assertSpec(spec);
  const specId = careerEvidenceSpecId(spec);
  const [different, review, same] = spec.questions.identity;
  const identityQuestions = {
    decision: choice(spec.questions.identityDecision, { different, review, same }),
    same_name: noul(spec.questions.identityFields.name),
    same_affiliation: noul(spec.questions.identityFields.affiliation),
    same_handle: noul(spec.questions.identityFields.handle),
  };
  const claimQuestions = {
    event_kind: choice(spec.questions.eventKind, spec.eventCriteria),
    difficulty: score(spec.questions.dimensions.difficulty, spec.levels.difficulty),
    ownership: score(spec.questions.dimensions.ownership, spec.levels.ownership),
    external_impact: score(spec.questions.dimensions.external_impact, spec.levels.external_impact),
    originality: score(spec.questions.dimensions.originality, spec.levels.originality),
    peer_validation: score(spec.questions.dimensions.peer_validation, spec.levels.peer_validation),
  };

  /** The state of an identity request: exactly what the model is shown. */
  const identityState = (identity: CanonicalIdentity, evidence: GrokEvidenceItem) => ({
    canonical_person: {
      name: identity.name,
      aliases: identity.aliases,
      external_identities: identity.externalIdentities.map((entry) => ({
        source: entry.source,
        external_id: entry.externalId,
        url: entry.url,
      })),
    },
    incoming_evidence: {
      publisher: evidence.publisher,
      url: evidence.url,
      statement: evidence.statement,
      quoted_text: evidence.quotedText,
    },
  });

  /** The state of a claim request. The person is not shown: only the evidence. */
  const claimState = (evidence: GrokEvidenceItem) => ({
    source: evidence.source,
    publisher: evidence.publisher,
    published_at: evidence.publishedAt,
    source_url: evidence.url,
    statement: evidence.statement,
    quoted_evidence: evidence.quotedText,
  });

  const fingerprintOf = (state: unknown, questions: unknown): string =>
    requestFingerprint({ state, questions, specId });

  return {
    identityFingerprint(identity, evidence) {
      return fingerprintOf(identityState(identity, evidence), identityQuestions);
    },

    claimFingerprint(evidence) {
      return fingerprintOf(claimState(evidence), claimQuestions);
    },

    async assessIdentity(identity, evidence, options): Promise<JevJudgment<IdentityAssessment>> {
      const state = identityState(identity, evidence);
      const { data, requestId } = await client
        .systemOne({ state, questions: identityQuestions }, requestOptions(options))
        .withResponse();
      const answers = data.answers;
      const decision = answers.decision;
      const record = writeRecord({
        kind: "identity",
        personId: identity.personId,
        evidence,
        fingerprint: fingerprintOf(state, identityQuestions),
        specId,
        requestedModel: spec.model,
        result: data,
        requestId,
        answers: {
          decision: {
            choice: decision.choice,
            confidence: decision.confidence,
            probabilities: { ...decision.probabilities },
          },
          same_name: { noul: answers.same_name.noul },
          same_affiliation: { noul: answers.same_affiliation.noul },
          same_handle: { noul: answers.same_handle.noul },
        },
      });
      return { assessment: projectIdentity(record, spec), record };
    },

    async assessClaim(evidence, personId, options): Promise<JevJudgment<ClaimAssessment>> {
      const state = claimState(evidence);
      const { data, requestId } = await client
        .systemOne({ state, questions: claimQuestions }, requestOptions(options))
        .withResponse();
      const answers = data.answers;
      const event = answers.event_kind;
      const record = writeRecord({
        kind: "claim",
        personId,
        evidence,
        fingerprint: fingerprintOf(state, claimQuestions),
        specId,
        requestedModel: spec.model,
        result: data,
        requestId,
        answers: {
          event_kind: {
            choice: event.choice,
            confidence: event.confidence,
            probabilities: { ...event.probabilities },
          },
          ...Object.fromEntries(
            CAREER_EVIDENCE_DIMENSIONS.map((dimension) => [
              dimension,
              rawScoreAnswer(answers[dimension], spec.levels[dimension], dimension),
            ]),
          ),
        },
      });
      return { assessment: projectClaim(record, spec), record };
    },
  };
}

/**
 * The caller's cancellation, and nothing else.
 *
 * `timeout` and `retry` are the client's, set once at construction
 * (`createJevClient`); the only per-call transport option is the signal the
 * pipeline threads through from `EvidenceRuntime`. A run with no signal sends
 * no options at all rather than a key holding `undefined`.
 */
function requestOptions(options: JevRequestOptions | undefined): RequestOptions {
  return options?.signal === undefined ? {} : { signal: options.signal };
}

/**
 * The probability vector and the legend, indexed by rubric level.
 *
 * The SDK keys both by score, and object key order is not the rubric's: each
 * level is read out by its index in `spec.levels`, so a response whose keys
 * arrive in any order still produces the vector the rubric describes.
 */
function rawScoreAnswer(
  answer: ScoreResponse<ScoreLevels>,
  levels: ScoreLevels,
  dimension: string,
): JevAnswer {
  const keyed = answer.probabilities as unknown as Record<string, unknown>;
  const legend = answer.legend as unknown as Record<string, unknown>;
  return {
    score: finite(answer.score, `${dimension}.score`),
    confidence: finite(answer.confidence, `${dimension}.confidence`),
    probabilities: levels.map((_level, index) =>
      finite(keyed[String(index)], `${dimension}.probabilities[${index}]`),
    ),
    legend: levels.map((_level, index) => String(legend[String(index)] ?? "")),
  };
}

/**
 * The number this field has to be, or a broken invariant.
 *
 * Every shape check in this adapter comes through here: the expected score
 * and its confidence, each entry of the probability vector, and the token
 * usage. A transport failure is an *unavailable* judgment and the pipeline
 * isolates it as one; a response that arrived and cannot be read is not — it
 * is corruption, in the model's answer or in this parsing, and no retry fixes
 * it. Raising the same class `records.ts` raises keeps the two sides
 * symmetric: unreadable is loud wherever it is noticed, live or recorded.
 */
function finite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new JudgmentInvariantError(`jev: ${what} must be a finite number (got ${String(value)})`);
  }
  return value;
}

/** Everything one record needs that is not an answer. */
interface RecordInput {
  kind: JevJudgmentRecord["kind"];
  personId: string;
  evidence: GrokEvidenceItem;
  fingerprint: string;
  specId: string;
  requestedModel: string;
  // biome-ignore lint/suspicious/noExplicitAny: any question set; only model and usage are read here.
  result: SystemOneResult<any>;
  requestId: string | undefined;
  answers: Record<string, JevAnswer>;
}

/** Build the observation and freeze it. Nothing rewrites a record afterwards. */
function writeRecord(input: RecordInput): JevJudgmentRecord {
  const usage = input.result.usage;
  const evidenceKey = evidenceKeyFor(input.personId, input.evidence);
  return freezeRecord({
    // The request fingerprint alone would name two people's judgments the
    // same: the person is not part of what was sent.
    id: recordIdFor(input.fingerprint, evidenceKey),
    kind: input.kind,
    personId: input.personId,
    evidenceKey,
    requestFingerprint: input.fingerprint,
    specId: input.specId,
    requestedModel: input.requestedModel,
    // Verbatim: an answer from a different model is a fact about this
    // judgment, not a mismatch to be normalised away.
    respondedModel: input.result.model,
    // `null`, never absent: an unreported request id is a recorded absence.
    requestId: input.requestId ?? null,
    answers: input.answers,
    usage: {
      inputTokens: finite(usage?.input_tokens, "usage.input_tokens"),
      outputTokens: finite(usage?.output_tokens, "usage.output_tokens"),
    },
    observedAt: new Date().toISOString(),
  });
}
