import { choice, noul, score, type TypeSafeClient } from "@typesafe-ai/sdk";
import { CAREER_EVIDENCE_DIMENSIONS } from "../../../../src/longitudinal/dimensions.ts";
import type { JevJudgmentService } from "../../../../src/longitudinal/judgments.ts";
import type { ProgressDimension } from "../../../../src/longitudinal/types.ts";

const EVENT_CRITERIA = {
  selective_role_transition:
    "A dated selection into a role, team, fellowship, or organization with meaningful responsibility.",
  shipped_product: "A product, system, or substantial feature was shipped for real users.",
  open_source_contribution:
    "A concrete open-source release or contribution, not merely repository activity.",
  research_output: "A paper, patent, study, dataset, or other substantive research output.",
  venture_traction:
    "Evidence of venture progress such as adoption, revenue, financing, or a consequential partnership.",
  grant_or_award: "A selective grant, prize, or award based on work or demonstrated potential.",
  community_or_craft_contribution:
    "A consequential contribution to a professional community or demanding craft.",
  no_supported_event:
    "The evidence does not establish a dated career event, is promotional only, or is too vague.",
} as const;

type ScoreLevels = [string, string, ...string[]];

/** Rubric text for each dimension: one entry per point on the shared 0..MAX_LEVEL scale. */
export const LEVELS: Record<ProgressDimension, ScoreLevels> = {
  difficulty: [
    "Routine work with no evidence of unusual technical, creative, or operational difficulty.",
    "Some non-routine difficulty, but the evidence does not show demanding constraints.",
    "Meaningfully difficult work requiring solid specialist judgment.",
    "Very difficult work with substantial uncertainty, constraints, or technical depth.",
    "Exceptional difficulty relative to the field, with clear evidence of solving a rare hard problem.",
  ],
  ownership: [
    "No evidence this person owned the work.",
    "Contributed under close direction or ownership is unclear.",
    "Owned a meaningful bounded part of the work.",
    "Led the work or held end-to-end responsibility for a consequential part.",
    "Created and drove the work with exceptional autonomy and accountability.",
  ],
  external_impact: [
    "No demonstrated external use or effect.",
    "Plausible effect, but no concrete adoption or result is evidenced.",
    "Clear use or benefit for a bounded audience.",
    "Substantial adoption, measurable result, or field-relevant influence.",
    "Exceptional durable impact relative to comparable work in the field.",
  ],
  originality: [
    "No evidence of a new approach or original contribution.",
    "Minor adaptation of established approaches.",
    "A meaningfully original choice, synthesis, or contribution.",
    "A highly original approach that changes what is possible or how the problem is understood.",
    "Exceptional field-shaping originality supported by the cited evidence.",
  ],
  peer_validation: [
    "No independent validation; only self-description.",
    "Weak or informal validation.",
    "Credible independent adoption, selection, review, or recognition.",
    "Strong validation by respected users, peers, institutions, or maintainers.",
    "Exceptional broad or highly selective validation relative to the field.",
  ],
};

/** Server-side TypeSafe/Jev adapter. Keep the API key out of browser bundles. */
export function createJevJudgmentService(client: TypeSafeClient): JevJudgmentService {
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
        questions: {
          decision: choice("How should the incoming evidence be linked to the canonical person?", {
            different: "It describes a different person and must remain unlinked.",
            review:
              "It may describe the person, but the evidence is ambiguous and needs human review.",
            same: "It describes the same person and can be linked.",
          }),
          same_name: noul(
            "Does the incoming evidence identify the same name or a documented alias?",
          ),
          same_affiliation: noul(
            "Are affiliations or career context mutually consistent with the canonical person?",
          ),
          same_handle: noul("Does the publisher, handle, or URL match a known external identity?"),
        },
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
        questions: {
          event_kind: choice(
            "Which single career event, if any, is established by the cited evidence?",
            EVENT_CRITERIA,
          ),
          difficulty: score(
            "How difficult is the evidenced work relative to its field?",
            LEVELS.difficulty,
          ),
          ownership: score(
            "How much ownership did this person have over the evidenced work?",
            LEVELS.ownership,
          ),
          external_impact: score(
            "How much external impact is demonstrated by the cited evidence?",
            LEVELS.external_impact,
          ),
          originality: score(
            "How original is the contribution demonstrated by the cited evidence?",
            LEVELS.originality,
          ),
          peer_validation: score(
            "How strong is independent peer or market validation in the cited evidence?",
            LEVELS.peer_validation,
          ),
        },
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
