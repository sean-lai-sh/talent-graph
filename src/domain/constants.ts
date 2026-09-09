/**
 * Canonical constants and product copy.
 *
 * The numeric constants here are the *values* of the first ReferralSignalSpec
 * version (see `src/models/registry.ts`). Prompt and label text is copied
 * verbatim from the MVP prompt so a UI never has to re-type it.
 */

import type { Dimension, EvidenceType, ForecastKind, RubricScore, Scale5 } from "./types.ts";

/** Canonical dimension order. Used for stable iteration and display. */
export const DIMENSIONS: readonly Dimension[] = [
  "problem_solving",
  "learning_velocity",
  "agency",
  "taste",
  "output",
  "generativity",
  "originality",
] as const;

/** m_e — evidence-type multiplier applied to the weighted referral score. */
export const EVIDENCE_MULTIPLIER: Record<EvidenceType, number> = {
  firsthand_work: 1.0,
  firsthand_personal: 0.9,
  artifact: 0.85,
  reputation: 0.6,
  other: 0.7,
};

/** Weights of X_uv = 0.50·n(conviction) + 0.30·n(confidence) + 0.20·n(depth). */
export const REFERRAL_WEIGHTS = {
  conviction: 0.5,
  confidence: 0.3,
  relationshipDepth: 0.2,
} as const;

export const EVIDENCE_TYPES: readonly EvidenceType[] = [
  "firsthand_work",
  "firsthand_personal",
  "artifact",
  "reputation",
  "other",
] as const;

/** Allowed `Referral.forecastKind` values. Omitted ≡ `"unspecified"`. */
export const FORECAST_KINDS: readonly ForecastKind[] = ["unspecified", "will_compound"] as const;

/** Evidence types that represent direct personal observation. */
export const FIRSTHAND_EVIDENCE_TYPES: readonly EvidenceType[] = [
  "firsthand_work",
  "firsthand_personal",
] as const;

/** Pairwise comparison prompts, verbatim from the MVP prompt §14. */
export const DIMENSION_PROMPTS: Record<Dimension, string> = {
  problem_solving:
    "Which person would you trust more with a genuinely difficult, ambiguous problem?",
  learning_velocity: "Who becomes effective in an unfamiliar domain faster?",
  agency:
    "Who is more likely to turn an underspecified problem into concrete progress without needing direction?",
  taste: "Who more consistently chooses the right problems or approaches?",
  output: "Who more consistently turns ability into meaningful results?",
  generativity: "Who makes strong people around them substantially better?",
  originality: "Who more often produces useful ideas or frames that others did not see?",
};

/** Primary referral priming prompt, verbatim from the MVP prompt §7. */
export const REFERRAL_PRIMARY_PROMPT =
  "Who is one of the smartest, most unusually capable, or most under-recognized people you know whom we should meet?";

/** Optional referral priming prompts, verbatim from the MVP prompt §7. */
export const REFERRAL_OPTIONAL_PROMPTS: readonly string[] = [
  "Who is much better than their credentials suggest?",
  "Who do you call when you're stuck on something genuinely difficult?",
  "Who has made you update your model of what one person can accomplish?",
  "Who becomes effective in unfamiliar domains unusually quickly?",
  "Who consistently sees something important before other people do?",
  "Who makes unusually strong people around them better?",
] as const;

/** Primary prompt followed by the six optional prompts (MVP prompt §7). */
export const REFERRAL_PRIMING_PROMPTS: readonly string[] = [
  REFERRAL_PRIMARY_PROMPT,
  ...REFERRAL_OPTIONAL_PROMPTS,
] as const;

/**
 * Asked once a candidate is selected or created. This evidence field should
 * visually matter more than the numeric sliders (MVP prompt §7).
 */
export const REFERRAL_EVIDENCE_PROMPT =
  "What did you personally observe that caused you to believe this?";

/** Anchors for the 1–5 referral sliders and the 0–4 rubric (§8, §12). */
export const SCALE_LABELS = {
  conviction: {
    1: "mild recommendation",
    2: "thinks they are good",
    3: "strongly recommends",
    4: "unusually strong conviction",
    5: '"this person is exceptional; you should meet them"',
  } satisfies Record<Scale5, string>,
  confidence: {
    1: "speculative",
    2: "limited evidence",
    3: "moderate evidence",
    4: "strong evidence",
    5: "extensive direct evidence",
  } satisfies Record<Scale5, string>,
  relationshipDepth: {
    1: "barely know them",
    2: "occasional interaction",
    3: "meaningful interaction",
    4: "worked closely together",
    5: "extensive firsthand collaboration",
  } satisfies Record<Scale5, string>,
  rubric: {
    0: "strong evidence behavior is weak",
    1: "roughly ordinary relative to relevant peers",
    2: "clearly above ordinary peers",
    3: "unusually strong; experienced observers notice",
    4: "repeatedly surprising even to strong domain experts",
  } satisfies Record<RubricScore, string>,
  /** Displayed for a `null` rubric score. */
  rubricNotObserved: "not observed",
} as const;

/** Approved product vocabulary. Any UI must use these exact strings. */
export const PRODUCT_LANGUAGE = {
  referralSignal: "Referral Signal",
  relativeCapability: "Relative Capability Estimate",
  insufficientEvidence: "Insufficient Evidence",
  notObserved: "Not Observed",
  structuredEvidence: "Structured Evidence",
  underRecognitionGap: "Under-Recognition Gap",
  exploratory: "Exploratory",
  scoutInformationGain: "Scout Information Gain",
  intensityCalibration: "Intensity Calibration",
  judgeReliability: "Judge Reliability",
  residualSlope: "Residual Slope",
} as const;

/**
 * Phrases that must never appear anywhere in `src/`. Asserted by the
 * invariants test: the model estimates relative evidence, not human value.
 * "Scout Score" is banned as a collapsed product of p̂ and Ĝ.
 */
export const BANNED_LANGUAGE: readonly string[] = [
  "Talent Score",
  "Intelligence Score",
  "Capability Score",
  "Objective Rank",
  "Human Value",
  "Scout Score",
] as const;
