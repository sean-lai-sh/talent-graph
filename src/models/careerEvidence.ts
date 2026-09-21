/**
 * The registered career-evidence rubric, kept in a leaf module.
 *
 * `registry.ts` side-effect-imports the model definitions, which reach into
 * `scoring/`, `inference/` and `judges/`. The longitudinal evidence pipeline
 * and the Club Jev adapter both need this spec, and neither may touch the
 * Referral Signal or capability code — not even transitively, and not in the
 * Next/Convex bundle. So the constant and its hash live here, importing only
 * the spec types, the freezer and the provenance hash; `registry.ts` imports
 * *this* module to append the version to `SPEC_HISTORY`.
 *
 * `tests/careerEvidenceSpec.test.ts` pins the boundary in both directions.
 */

import { hashInputs } from "../provenance/hash.ts";
import { deepFreeze } from "./freeze.ts";
import { type CareerEvidenceSpec, specId } from "./spec.ts";

/**
 * V1 of the career-evidence rubric, carrying the level descriptions, question
 * text, event taxonomy and gate thresholds exactly as they shipped in the
 * Club Jev adapter. The text is the spec: a reworded level would change every
 * judgment already stamped `career_evidence@1.0.0`, so it is copied here
 * verbatim and pinned by hash in `tests/careerEvidenceSpec.test.ts`.
 */
export const CAREER_EVIDENCE_V1_0_0: CareerEvidenceSpec = deepFreeze({
  kind: "career_evidence",
  version: "1.0.0",
  model: "jev",
  levels: {
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
  },
  questions: {
    identityDecision: "How should the incoming evidence be linked to the canonical person?",
    identity: [
      "It describes a different person and must remain unlinked.",
      "It may describe the person, but the evidence is ambiguous and needs human review.",
      "It describes the same person and can be linked.",
    ],
    identityFields: {
      name: "Does the incoming evidence identify the same name or a documented alias?",
      affiliation:
        "Are affiliations or career context mutually consistent with the canonical person?",
      handle: "Does the publisher, handle, or URL match a known external identity?",
    },
    eventKind: "Which single career event, if any, is established by the cited evidence?",
    dimensions: {
      difficulty: "How difficult is the evidenced work relative to its field?",
      ownership: "How much ownership did this person have over the evidenced work?",
      external_impact: "How much external impact is demonstrated by the cited evidence?",
      originality: "How original is the contribution demonstrated by the cited evidence?",
      peer_validation: "How strong is independent peer or market validation in the cited evidence?",
    },
  },
  eventCriteria: {
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
  },
  thresholds: {
    identityConfidence: 0.75,
    identityContradiction: 0.25,
    eventConfidence: 0.65,
    dimensionConfidence: 0.5,
  },
});

/**
 * Hash of everything in the spec that can change an answer: the rubric
 * levels, the question text, the event criteria and the model requested. The
 * version alone cannot catch a silent edit — this can.
 */
export function careerEvidenceRubricHash(spec: CareerEvidenceSpec): string {
  return hashInputs({
    levels: spec.levels,
    questions: spec.questions,
    eventCriteria: spec.eventCriteria,
    model: spec.model,
  });
}

/**
 * `"career_evidence@1.0.0:9f2c1ab4"` — the plain spec id plus the rubric
 * hash, so a silently edited level description changes the identifier even
 * though the version did not move.
 */
export function careerEvidenceSpecId(spec: CareerEvidenceSpec): string {
  return `${specId(spec)}:${careerEvidenceRubricHash(spec).slice(0, 8)}`;
}
