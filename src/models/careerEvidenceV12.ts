import { hashInputs } from "../provenance/hash.ts";
import { deepFreeze } from "./freeze.ts";
import { type CareerEvidenceV12Spec, specId } from "./spec.ts";

const SELECTIVITY_CUTS = [
  { maxRate: 0.01, level: 4 },
  { maxRate: 0.05, level: 3 },
  { maxRate: 0.2, level: 2 },
  { maxRate: 0.5, level: 1 },
] as const satisfies CareerEvidenceV12Spec["selectivityCuts"];

const SELECTIVITY_QUESTION =
  "Using only `text`, how selective was this choice from a pool? " +
  "When `selection_rate` is present, map it to the anchor band that contains it. " +
  "A rate of at most 0.01 is level 4, at most 0.05 is level 3, at most 0.20 is level 2, " +
  "at most 0.50 is level 1, and any higher rate is level 0. Each bound is inclusive. " +
  "When `selection_rate_upper_bound` is true, the rate is a ceiling because the pool was at least that large, " +
  "so do not assign a less selective level than the band for that ceiling. " +
  "When no rate is present, use the qualitative half of the anchors.";

const POOL_QUESTION =
  "Using only `text`, how broad was the pool this person was chosen from? " +
  "Never rate a country, city, or region as a stronger or weaker pool. " +
  "Only breadth of eligibility counts: one school, a national open pool, or an international pool. " +
  "Breadth of eligibility is a fact about the rules. Whether a region is strong is not asked. " +
  "If the text does not say what the pool was, answer the most likely level with low confidence. " +
  "Do not answer 0 only because the pool was not stated.";

const SCALE_QUESTION =
  "Using only `text`, how far does this work reach beyond the people who made it? " +
  "If the text does not say who uses it, answer the most likely level with low confidence. " +
  "Do not answer 0 only because reach was not stated.";

const ROLE_QUESTION =
  "Using only `text`, what part did this person play in the work? " +
  "When `role_seed` is present, it is a prior taken from the claim's verb and already mapped onto these four parts. It is not a verdict. " +
  "When `title_hint` is present, it is the job title. Titles are not scored. Verbs and scope count more.";

const CLASS_QUESTION =
  "Using only `text`, which class is this claim? " +
  "When `title_hint` is present, it is the job title. Titles are not scored. Verbs and scope count more.";

export const CAREER_EVIDENCE_V1_2_0: CareerEvidenceV12Spec = deepFreeze({
  kind: "career_evidence",
  version: "1.2.0",
  model: "jev",
  claimClass: {
    question: CLASS_QUESTION,
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
  pool_strength: {
    question: POOL_QUESTION,
    levels: [
      "No competitive pool is shown. Everyone who applied got in, or the pool was a handful of people picked informally. Example: selected as team note-taker, or an open-enrollment course certificate.",
      "One class, one team, one school, or one company's internal pool, with no pre-filter beyond membership. Example: a single school's design competition, 1 in 400 from one school, or a course's best-project award.",
      "Campus-wide at a selective school, with a published admission rate at or below about 20%, or a pool open to several schools or companies whose entrants had already passed one screen. Example: a university-wide research fellowship at a selective school, or an inter-college hackathon with an application round.",
      "A national open pool, where anyone in the country in the eligible group can enter and the entrant count is large or published. Example: a national olympiad qualifier, or a national fellowship with a published applicant count.",
      "An international or elite pre-filtered pool, where entrants are already among the strongest in the field. Example: an IMO team, top Putnam ranks, an international olympiad, or a top global fellowship.",
    ],
  },
  difficulty: {
    question:
      "Using only `text`, how hard was the work relative to what a practitioner in the field could already do?",
    levels: [
      "Textbook exercise or tutorial follow-along. A worked solution is widely published. Example: a to-do app from a tutorial, course homework, or a standard CRUD app.",
      "A standard task done competently. The approach is well known, mostly integrating common libraries. Example: a REST API and dashboard for a club, or adding a feature to an existing app with off-the-shelf components.",
      "A non-trivial problem that needed design judgment, with no step-by-step guide. The text names the design choices or a measured target that was hit. Example: cut p95 latency from 800 ms to 120 ms by redesigning caching, a job queue with retries and idempotency, or fine-tuning and evaluating a model on a new dataset.",
      "A hard problem most practitioners could not solve without serious study. Evidence is a top-venue paper, beating a published baseline, a novel component merged upstream into a major project, or solving a problem others publicly tried and failed at. Example: a GPU kernel that beats the vendor library on a real workload, a compiler pass merged upstream, or a first-author paper at a top venue.",
      "Only one person or team has done it, or it was the first ever. Evidence is a first demonstration, a record, or a best-known result others cite as the first. Example: resolving a known open problem, or the original implementation of a technique the field then adopted.",
    ],
  },
  scale: {
    question: SCALE_QUESTION,
    levels: [
      "No users beyond the makers. Example: a class project that was graded and shelved, or a personal demo.",
      "A small named audience: tens of users, or one team or club. Example: a club attendance app used by 40 members, or an internal script used by the author's own team.",
      "A bounded audience outside the team: hundreds to low thousands of users, several teams in one organization, or open source with hundreds of stars or thousands of weekly downloads. Example: an internal tool adopted by three teams at a company, or an npm package with about 5k weekly downloads.",
      "Broad adoption: company-wide core infrastructure at a large company, tens of thousands of users or more, measurable revenue, or open source that widely used projects depend on, at 10k or more stars or millions of monthly downloads. Example: an intern's service that became company-wide core infrastructure, or a library that major frameworks depend on.",
      "Used globally and field-defining: millions of users, or a standard the field builds on. Example: CUDA, ChatGPT, PyTorch, React, or a Linux kernel subsystem.",
    ],
  },
  role: {
    question: ROLE_QUESTION,
    original_author: "The person created, founded, or wrote the core of the thing.",
    major_contributor: "The person built a substantial part that was clearly theirs.",
    maintainer:
      "The person kept it running, reviewed, released, or triaged, without authoring the core.",
    minor_part: "The person assisted or helped under someone else's direction.",
  },
  selectivityCuts: SELECTIVITY_CUTS,
  thresholds: {
    classConfidence: 0.65,
    dimensionConfidence: 0.5,
  },
});

export const CAREER_EVIDENCE_V1_2_1: CareerEvidenceV12Spec = deepFreeze({
  ...CAREER_EVIDENCE_V1_2_0,
  version: "1.2.1",
});

const NO_COMPANY_EVIDENCE_SENTENCE =
  "When `selection_rate` is absent, no company evidence is available.";

const SELECTIVITY_QUESTION_V122 = `${SELECTIVITY_QUESTION} ${NO_COMPANY_EVIDENCE_SENTENCE}`;

const POOL_QUESTION_V122 = `${POOL_QUESTION} ${NO_COMPANY_EVIDENCE_SENTENCE}`;

const SCALE_QUESTION_V122 =
  "Using only `text`, how far does this work reach beyond the people who made it? " +
  "When the text states a quantity, map that number onto exactly one level using the ranges in the anchors. " +
  "A stated number is mapped, not hedged. Do not split probability between adjacent levels. " +
  "The lower end of a range is inclusive and belongs to that level. " +
  "If the text states both an audience and a percent, the audience sets the level. " +
  "If the text states only a percent, map that percent with the percent ranges and still pick one level. " +
  "If the text states no quantity, pick the most likely level from who the audience is, and put the probability on that one level. " +
  "Do not answer 0 only because reach was not stated.";

export const CAREER_EVIDENCE_V1_2_2: CareerEvidenceV12Spec = deepFreeze({
  ...CAREER_EVIDENCE_V1_2_1,
  version: "1.2.2",
  selectivity: {
    question: SELECTIVITY_QUESTION_V122,
    levels: CAREER_EVIDENCE_V1_2_1.selectivity.levels,
  },
  pool_strength: {
    question: POOL_QUESTION_V122,
    levels: CAREER_EVIDENCE_V1_2_1.pool_strength.levels,
  },
  scale: {
    question: SCALE_QUESTION_V122,
    levels: [
      "No users beyond the makers. Example: a class project that was graded and shelved, or a personal demo. Do not put a stated quantity here unless the text says nobody else used the work.",
      "A small named audience. Users 1 to 99. Requests, events, or downloads under 1,000. One team, or a team of at most 15 people. Money under $10,000. A percent improvement under 20% when no audience is stated. Example: a club attendance app used by 40 members, or an internal script used by the author's own team.",
      "A bounded audience outside the team. Users 100 to 9,999. Requests, events, or downloads from 1,000 to 999,999. Several teams, or a team of 16 to 200 people. Money from $10,000 to under $1,000,000. A percent improvement from 20% to under 50% when no audience is stated. Open source with hundreds of stars or thousands of weekly downloads. Example: an internal tool adopted by three teams at a company, or an npm package with about 5k weekly downloads.",
      "Broad adoption. Users from 10,000 to 999,999. Requests, events, or downloads from 1,000,000 to 99,999,999. Company-wide, or more than 200 people. Money from $1,000,000 to under $100,000,000. A percent improvement of 50% or more when no audience is stated. Open source at 10,000 or more stars, or millions of monthly downloads. Example: an intern's service that became company-wide core infrastructure, or a library that major frameworks depend on.",
      "Used globally and field-defining. Users 1,000,000 or more. Requests, events, or downloads 100,000,000 or more. Money $100,000,000 or more. Do not assign level 4 from a percent alone. Example: CUDA, ChatGPT, PyTorch, React, or a Linux kernel subsystem.",
    ],
  },
});

const NOT_REACH_SENTENCE =
  "An applicant or acceptance count, an absolute quality percentage, and a data or sample size are not reach. " +
  "Set the level from the stated or implied audience instead. " +
  "Convert a speedup to a percent improvement. " +
  "A before-and-after time, or a multiplier of 2x or more, counts as an improvement of at least 50%, and then use the percent ranges.";

const ONE_LEVEL_WHEN_UNSTATED =
  "If the text states no quantity, pick the most likely level from who the audience is, and put the probability on that one level. ";

export const CAREER_EVIDENCE_V1_2_3: CareerEvidenceV12Spec = deepFreeze({
  ...CAREER_EVIDENCE_V1_2_2,
  version: "1.2.3",
  selectivity: CAREER_EVIDENCE_V1_2_1.selectivity,
  pool_strength: CAREER_EVIDENCE_V1_2_1.pool_strength,
  scale: {
    question: `${SCALE_QUESTION_V122.replace(ONE_LEVEL_WHEN_UNSTATED, "")} ${NOT_REACH_SENTENCE}`,
    levels: CAREER_EVIDENCE_V1_2_2.scale.levels,
  },
});

/** 1.2.4 keeps the 1.2.3 text. The company-context sentence lives in its question plan. */
export const CAREER_EVIDENCE_V1_2_4: CareerEvidenceV12Spec = deepFreeze({
  ...CAREER_EVIDENCE_V1_2_3,
  version: "1.2.4",
});

const COMPANY_CONTEXT_SENTENCE =
  "When `company_context` is present, treat its sourced facts about the employer at the hire date " +
  "(stage, top investor, published acceptance rate, hiring bar) as evidence for this answer, " +
  "and infer nothing from a fact it does not list.";

export function selectivityLevelForRate(
  rate: number,
  spec: CareerEvidenceV12Spec = CAREER_EVIDENCE_V1_2_0,
): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error(`selection rate must be a finite number ≥ 0 (got ${String(rate)})`);
  }
  for (const cut of spec.selectivityCuts) {
    if (rate <= cut.maxRate) return cut.level;
  }
  return 0;
}

export type CareerEvidenceV12QuestionKey =
  | "claim_class"
  | "selectivity"
  | "pool_strength"
  | "difficulty"
  | "scale"
  | "role";

/** How a class answer becomes a stored class and a review reason. */
export type CareerEvidenceV12ClassHandling =
  | { source: "model"; classGate: "apply" }
  | { source: "structural"; confidence: 1; classGate: "skip" };

export interface CareerEvidenceV12QuestionPlan {
  dated: {
    selection: readonly CareerEvidenceV12QuestionKey[];
    output: readonly CareerEvidenceV12QuestionKey[];
    classHandling: CareerEvidenceV12ClassHandling;
    /**
     * Sent with a dated selection claim that has sourced company facts:
     * the state gains `company_context`, and this sentence is appended to
     * the selectivity and pool_strength questions. Absent before 1.2.4.
     */
    companyContext?: string;
  };
  free: {
    probe: readonly CareerEvidenceV12QuestionKey[];
    selection: readonly CareerEvidenceV12QuestionKey[];
    output: readonly CareerEvidenceV12QuestionKey[];
    classHandling: CareerEvidenceV12ClassHandling;
  };
}

const MODEL_CLASS = { source: "model", classGate: "apply" } as const;
const STRUCTURAL_CLASS = { source: "structural", confidence: 1, classGate: "skip" } as const;

const FREE_ASK = {
  probe: ["claim_class"],
  selection: ["claim_class", "selectivity", "pool_strength"],
  output: ["claim_class", "difficulty", "scale", "role"],
  classHandling: MODEL_CLASS,
} as const satisfies CareerEvidenceV12QuestionPlan["free"];

/**
 * Which questions each claim kind is asked, and how class becomes a status.
 * The scorer reads this. The rubric hash serializes it. A version that asks
 * a different set cannot keep the previous digest.
 */
const QUESTION_PLANS = {
  "1.2.0": {
    dated: {
      selection: ["claim_class", "selectivity", "pool_strength"],
      output: ["claim_class", "difficulty", "scale", "role"],
      classHandling: MODEL_CLASS,
    },
    free: FREE_ASK,
  },
  "1.2.1": {
    dated: {
      selection: ["selectivity", "pool_strength"],
      output: ["difficulty", "scale", "role"],
      classHandling: STRUCTURAL_CLASS,
    },
    free: FREE_ASK,
  },
  "1.2.2": {
    dated: {
      selection: ["selectivity", "pool_strength"],
      output: ["difficulty", "scale", "role"],
      classHandling: STRUCTURAL_CLASS,
    },
    free: FREE_ASK,
  },
  "1.2.3": {
    dated: {
      selection: ["selectivity", "pool_strength"],
      output: ["difficulty", "scale", "role"],
      classHandling: STRUCTURAL_CLASS,
    },
    free: FREE_ASK,
  },
  "1.2.4": {
    dated: {
      selection: ["selectivity", "pool_strength"],
      output: ["difficulty", "scale", "role"],
      classHandling: STRUCTURAL_CLASS,
      companyContext: COMPANY_CONTEXT_SENTENCE,
    },
    free: FREE_ASK,
  },
} as const satisfies Record<CareerEvidenceV12Spec["version"], CareerEvidenceV12QuestionPlan>;

export function careerEvidenceV12QuestionPlan(
  spec: CareerEvidenceV12Spec,
): CareerEvidenceV12QuestionPlan {
  return QUESTION_PLANS[spec.version];
}

/**
 * Template text plus the per-claim-kind ask. This object is the rubric hash.
 * 1.2.0 shipped hashing the template alone (`cd500b05`), so its plan stays
 * out of the hash to keep that stamp valid.
 */
export function careerEvidenceV12Behavior(spec: CareerEvidenceV12Spec) {
  const template = {
    model: spec.model,
    claimClass: spec.claimClass,
    selectivity: spec.selectivity,
    pool_strength: spec.pool_strength,
    difficulty: spec.difficulty,
    scale: spec.scale,
    role: spec.role,
    selectivityCuts: spec.selectivityCuts,
  };
  if (spec.version === "1.2.0") return template;
  return { ...template, questionPlan: careerEvidenceV12QuestionPlan(spec) };
}

export function careerEvidenceV12RubricHash(spec: CareerEvidenceV12Spec): string {
  return hashInputs(careerEvidenceV12Behavior(spec));
}

export function careerEvidenceV12SpecId(spec: CareerEvidenceV12Spec): string {
  return `${specId(spec)}:${careerEvidenceV12RubricHash(spec).slice(0, 8)}`;
}
