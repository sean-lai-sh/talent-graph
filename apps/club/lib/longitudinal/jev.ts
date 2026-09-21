/**
 * Server-side TypeSafe/Jev adapter. Keep the API key out of browser bundles.
 *
 * Every question below is built from `spec`: the instruction text, the
 * identity criteria, the event taxonomy and the rubric levels. Nothing the
 * model is asked is written here, so a judgment stamped with a spec version
 * can be reproduced from that version alone.
 *
 * The client and its transport policy live in `./jevClient.ts`, and turning a
 * response into a record in `./jevRecord.ts`; both are re-exported here so a
 * caller still has one import for the adapter.
 */

import type {
  APIPromise,
  RequestOptions,
  SystemOneRequest,
  SystemOneResult,
} from "@typesafe-ai/sdk";
import { CAREER_EVIDENCE_DIMENSIONS } from "../../../../src/longitudinal/dimensions.ts";
import type {
  ClaimAssessment,
  IdentityAssessment,
  JevJudgment,
  JevJudgmentService,
} from "../../../../src/longitudinal/judgments.ts";
import { projectClaim, projectIdentity } from "../../../../src/longitudinal/projections.ts";
import { unit } from "../../../../src/longitudinal/ranges.ts";
import { requestFingerprint } from "../../../../src/longitudinal/records.ts";
import type {
  CanonicalIdentity,
  CareerEvidenceDimension,
  GrokEvidenceItem,
} from "../../../../src/longitudinal/types.ts";
import {
  CAREER_EVIDENCE_V1_0_0,
  careerEvidenceSpecId,
} from "../../../../src/models/careerEvidence.ts";
import { assertSpec, type CareerEvidenceSpec } from "../../../../src/models/spec.ts";
import type { JevClaimQuestions, JevIdentityQuestions, ScoreLevels } from "./jevClient.ts";
import { claimQuestionsFor, identityQuestionsFor } from "./jevClient.ts";
import { rawScoreAnswer, requestOptions, writeRecord } from "./jevRecord.ts";

export {
  createJevClient,
  JEV_CLIENT_DEFAULTS,
  type JevClaimQuestions,
  type JevIdentityQuestions,
  type ScoreLevels,
} from "./jevClient.ts";

/**
 * The client surface this adapter uses — and the only thing a caller has to
 * provide.
 *
 * `TypeSafeClient` is a class with private members, so no object literal can
 * ever *be* one: a test double had to be cast through `unknown`, and a cast
 * through `unknown` type-checks against anything, including an SDK whose
 * response shape has moved underneath it. The dependency is narrowed to what
 * is actually called instead — `systemOne` for the two question sets above,
 * and of its `APIPromise` only `withResponse()` — which the real client
 * satisfies structurally, and which a double can satisfy honestly.
 *
 * The overloads are per question set rather than one generic signature so that
 * the answers are typed by the questions that were sent: `answers.decision` is
 * a choice response and `answers.difficulty` a score response, here and in any
 * double, with no narrowing of a union at either end.
 */
export interface JevClient {
  systemOne(
    request: SystemOneRequest<JevIdentityQuestions>,
    options?: RequestOptions,
  ): Pick<APIPromise<SystemOneResult<JevIdentityQuestions>>, "withResponse">;
  systemOne(
    request: SystemOneRequest<JevClaimQuestions>,
    options?: RequestOptions,
  ): Pick<APIPromise<SystemOneResult<JevClaimQuestions>>, "withResponse">;
}

/**
 * Rubric text for each dimension: one entry per point on the shared
 * 0..MAX_LEVEL scale. The text lives in the registered spec, not here — this
 * is the registered rubric, re-exported for the callers that read it.
 */
export const LEVELS: Record<CareerEvidenceDimension, ScoreLevels> = CAREER_EVIDENCE_V1_0_0.levels;

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
  client: JevClient,
  spec: CareerEvidenceSpec = CAREER_EVIDENCE_V1_0_0,
): JevJudgmentService {
  assertSpec(spec);
  const specId = careerEvidenceSpecId(spec);
  const identityQuestions = identityQuestionsFor(spec);
  const claimQuestions = claimQuestionsFor(spec);

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
        // Range-checked at arrival, exactly as the projections check them on
        // the way back out (`src/longitudinal/ranges.ts`). A confidence the
        // pipeline cannot represent must not become a record.
        answers: {
          decision: {
            choice: decision.choice,
            confidence: unit(decision.confidence, "jev: decision.confidence"),
            probabilities: { ...decision.probabilities },
          },
          same_name: { noul: unit(answers.same_name.noul, "jev: same_name.noul") },
          same_affiliation: {
            noul: unit(answers.same_affiliation.noul, "jev: same_affiliation.noul"),
          },
          same_handle: { noul: unit(answers.same_handle.noul, "jev: same_handle.noul") },
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
            confidence: unit(event.confidence, "jev: event_kind.confidence"),
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
