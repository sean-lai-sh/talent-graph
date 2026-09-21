import { choice, noul, score, type TypeSafeClient } from "@typesafe-ai/sdk";
import { CAREER_EVIDENCE_DIMENSIONS } from "../../../../src/longitudinal/dimensions.ts";
import type { JevJudgmentService } from "../../../../src/longitudinal/judgments.ts";
import type { ProgressDimension } from "../../../../src/longitudinal/types.ts";
import { CAREER_EVIDENCE_V1_0_0 } from "../../../../src/models/registry.ts";
import { assertSpec, type CareerEvidenceSpec } from "../../../../src/models/spec.ts";

type ScoreLevels = readonly [string, string, ...string[]];

/**
 * Rubric text for each dimension: one entry per point on the shared
 * 0..MAX_LEVEL scale. The text lives in the registered spec, not here — this
 * is the registered rubric, re-exported for the callers that read it.
 */
export const LEVELS: Record<ProgressDimension, ScoreLevels> = CAREER_EVIDENCE_V1_0_0.levels;

/**
 * Server-side TypeSafe/Jev adapter. Keep the API key out of browser bundles.
 *
 * Every question below is built from `spec`: the instruction text, the
 * identity criteria, the event taxonomy and the rubric levels. Nothing the
 * model is asked is written here, so a judgment stamped with a spec version
 * can be reproduced from that version alone.
 */
export function createJevJudgmentService(
  client: TypeSafeClient,
  spec: CareerEvidenceSpec = CAREER_EVIDENCE_V1_0_0,
): JevJudgmentService {
  assertSpec(spec);
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

  return {
    async assessIdentity(identity, evidence) {
      const response = await client.systemOne({
        state: {
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
        },
        questions: identityQuestions,
      });
      const decisionAnswer = response.answers.decision;
      return {
        decision: decisionAnswer.choice,
        confidence: decisionAnswer.confidence,
        fieldMatches: {
          name: response.answers.same_name.noul,
          affiliation: response.answers.same_affiliation.noul,
          handle: response.answers.same_handle.noul,
        },
      };
    },

    async assessClaim(evidence) {
      const response = await client.systemOne({
        state: {
          source: evidence.source,
          publisher: evidence.publisher,
          published_at: evidence.publishedAt,
          source_url: evidence.url,
          statement: evidence.statement,
          quoted_evidence: evidence.quotedText,
        },
        questions: claimQuestions,
      });
      const event = response.answers.event_kind;
      const dimensions = CAREER_EVIDENCE_DIMENSIONS.map((dimension) => {
        const answer = response.answers[dimension];
        return {
          dimension,
          score: answer.score,
          probabilities: Object.values(answer.probabilities).map(Number),
          confidence: answer.confidence,
        };
      });
      return {
        eventKind: event.choice === "no_supported_event" ? null : event.choice,
        eventConfidence: event.confidence,
        dimensions,
      };
    },
  };
}
