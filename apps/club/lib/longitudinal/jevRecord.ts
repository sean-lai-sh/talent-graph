/**
 * Turning one TypeSafe response into a judgment record.
 *
 * What comes back is written down whole: the request id alongside the parsed
 * body, the model that actually answered, the token usage, and the
 * per-question answers with their un-rounded expected scores, full probability
 * vectors and the legend the model reports having used. That record is the
 * observation; everything downstream is a projection of it.
 */

import type { RequestOptions, ScoreResponse, SystemOneResult } from "@typesafe-ai/sdk";
import type { JevRequestOptions } from "../../../../src/longitudinal/judgments.ts";
import type { JevAnswer, JevJudgmentRecord } from "../../../../src/longitudinal/records.ts";
import {
  evidenceKeyFor,
  JudgmentInvariantError,
  recordIdFor,
} from "../../../../src/longitudinal/records.ts";
import { freezeRecord } from "../../../../src/longitudinal/store.ts";
import type { GrokEvidenceItem } from "../../../../src/longitudinal/types.ts";
import type { ScoreLevels } from "./jevClient.ts";

/**
 * The caller's cancellation, and nothing else.
 *
 * `timeout` and `retry` are the client's, set once at construction
 * (`createJevClient`); the only per-call transport option is the signal the
 * pipeline threads through from `EvidenceRuntime`. A run with no signal sends
 * no options at all rather than a key holding `undefined`.
 */
export function requestOptions(options: JevRequestOptions | undefined): RequestOptions {
  return options?.signal === undefined ? {} : { signal: options.signal };
}

/**
 * The probability vector and the legend, indexed by rubric level.
 *
 * The SDK keys both by score, and object key order is not the rubric's: each
 * level is read out by its index in `spec.levels`, so a response whose keys
 * arrive in any order still produces the vector the rubric describes.
 */
export function rawScoreAnswer(
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
export function writeRecord(input: RecordInput): JevJudgmentRecord {
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
