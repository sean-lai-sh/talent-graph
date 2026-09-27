import { hashInputs } from "../provenance/hash.ts";
import { deepFreeze } from "./freeze.ts";
import { type CareerEvidenceV11Spec, specId } from "./spec.ts";

const SELECTIVITY_CUTS = [
  { maxRate: 0.01, level: 4 },
  { maxRate: 0.05, level: 3 },
  { maxRate: 0.2, level: 2 },
  { maxRate: 0.5, level: 1 },
] as const satisfies CareerEvidenceV11Spec["selectivityCuts"];

const SELECTIVITY_QUESTION =
  "Using only `text`, how selective was this choice from a pool? " +
  "When `selection_rate` is present, map it to the anchor band that contains it. " +
  "A rate of at most 0.01 is level 4, at most 0.05 is level 3, at most 0.20 is level 2, " +
  "at most 0.50 is level 1, and any higher rate is level 0. Each bound is inclusive. " +
  "When `selection_rate_upper_bound` is true, the rate is a ceiling because the pool was at least that large, " +
  "so do not assign a less selective level than the band for that ceiling. " +
  "When no rate is present, use the qualitative half of the anchors.";

export const CAREER_EVIDENCE_V1_1_0: CareerEvidenceV11Spec = deepFreeze({
  kind: "career_evidence",
  version: "1.1.0",
  model: "jev",
  claimClass: {
    question: "Using only `text`, which class is this claim?",
    selection:
      "The person was chosen from a pool, such as a fellowship, award, competitive role, or admission. The claim is not about something they made.",
    output:
      "The person made something, such as a product, research result, open-source work, a venture, or a community contribution. The claim is not about being chosen.",
    both: "The claim is both a selection and an output in one text. The person was chosen from a pool for making something, and the two parts are not already separate claims.",
  },
  selectivity: {
    question: SELECTIVITY_QUESTION,
    levels: [
      "More than 50% of the pool was chosen, or the evidence does not show a selective choice.",
      "At most 50% of the pool was chosen, and more than 20%. A modest screen.",
      "At most 20% of the pool was chosen, and more than 5%. A real competitive screen.",
      "At most 5% of the pool was chosen, and more than 1%. A highly selective screen.",
      "At most 1% of the pool was chosen. A rare fellowship, award, admission, or competitive role.",
    ],
  },
  difficulty: {
    question: "Using only `text`, how difficult is the work relative to its field?",
    levels: [
      "Routine work a practitioner in the field would do without unusual constraints.",
      "Some non-routine difficulty, without evidence of demanding constraints.",
      "Meaningfully difficult work that took solid specialist judgment.",
      "Very difficult work under substantial uncertainty, constraints, or technical depth.",
      "Exceptional difficulty for the field, with evidence of a rare hard problem.",
    ],
  },
  generalized_impact: {
    question:
      "Using only `text`, how far does the effect of this work reach beyond the people who made it?",
    levels: [
      "No demonstrated effect beyond the people who did the work.",
      "A plausible effect, without a concrete audience, adoption, or result.",
      "A clear effect for a bounded audience outside the immediate team.",
      "Substantial adoption, a measurable result, or influence beyond one organization.",
      "An exceptional durable effect relative to comparable work in the field.",
    ],
  },
  ownership: {
    question:
      "Using only `text`, what share of the work did this person hold? " +
      "When `ownership_seed` is present, it is a prior taken from the claim's verb and already mapped onto these three tiers. It is not a verdict.",
    led: "The person led, owned, or founded the work and held the outcome.",
    core_contributor:
      "The person built, developed, or designed a substantial part and was not only assisting.",
    supporting: "The person contributed, assisted, or helped under someone else's direction.",
  },
  selectivityCuts: SELECTIVITY_CUTS,
  thresholds: {
    classConfidence: 0.65,
    dimensionConfidence: 0.5,
  },
});

export function selectivityLevelForRate(
  rate: number,
  spec: CareerEvidenceV11Spec = CAREER_EVIDENCE_V1_1_0,
): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error(`selection rate must be a finite number ≥ 0 (got ${String(rate)})`);
  }
  for (const cut of spec.selectivityCuts) {
    if (rate <= cut.maxRate) return cut.level;
  }
  return 0;
}

export function careerEvidenceV11RubricHash(spec: CareerEvidenceV11Spec): string {
  return hashInputs({
    model: spec.model,
    claimClass: spec.claimClass,
    selectivity: spec.selectivity,
    difficulty: spec.difficulty,
    generalized_impact: spec.generalized_impact,
    ownership: spec.ownership,
    selectivityCuts: spec.selectivityCuts,
  });
}

export function careerEvidenceV11SpecId(spec: CareerEvidenceV11Spec): string {
  return `${specId(spec)}:${careerEvidenceV11RubricHash(spec).slice(0, 8)}`;
}
