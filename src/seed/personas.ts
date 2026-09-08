/**
 * The six intentionally interesting cases from the MVP prompt §30.
 *
 * `trueTheta` is the hidden ability used only to *sample* comparison outcomes
 * in the generator. It is never exported into the dataset and no algorithm
 * reads it; its only purpose is to give Bradley–Terry a known ordering to
 * recover.
 */

import type { Dimension, EvidenceType, Scale5 } from "../domain/types.ts";

export interface PersonaReferralShape {
  conviction: Scale5;
  confidence: Scale5;
  relationshipDepth: Scale5;
  evidenceType: EvidenceType;
}

export interface Persona {
  id: string;
  name: string;
  affiliation: string;
  bio: string;
  /** Incoming referrals to generate, in order. */
  referrals: PersonaReferralShape[];
  /** Hidden per-dimension ability. `null` ⇒ never compared on that dimension. */
  trueTheta: Record<Dimension, number | null>;
  /** Lower bound on comparisons the generator must produce for this person. */
  minComparisons: number;
  /** Upper bound; `null` ⇒ unbounded. */
  maxComparisons: number | null;
  /** Dimensions the generator prioritises when meeting `minComparisons`. */
  focusDimensions: Dimension[];
}

const strong: PersonaReferralShape = {
  conviction: 5,
  confidence: 4,
  relationshipDepth: 4,
  evidenceType: "firsthand_work",
};

const mediocre: PersonaReferralShape = {
  conviction: 2,
  confidence: 2,
  relationshipDepth: 2,
  evidenceType: "other",
};

function theta(values: Partial<Record<Dimension, number | null>>, rest: number | null) {
  return {
    problem_solving: rest,
    learning_velocity: rest,
    agency: rest,
    taste: rest,
    output: rest,
    generativity: rest,
    originality: rest,
    ...values,
  } satisfies Record<Dimension, number | null>;
}

export const PERSONAS: readonly Persona[] = [
  {
    id: "p-alice",
    name: "Alice Tanaka",
    affiliation: "Independent",
    bio: "Systems engineer; rebuilt a payments core from the ground up.",
    referrals: [
      strong,
      { conviction: 5, confidence: 5, relationshipDepth: 5, evidenceType: "firsthand_work" },
      { conviction: 4, confidence: 4, relationshipDepth: 3, evidenceType: "firsthand_personal" },
      { conviction: 5, confidence: 4, relationshipDepth: 4, evidenceType: "firsthand_work" },
    ],
    trueTheta: theta(
      { problem_solving: 1.9, learning_velocity: 1.8, agency: 1.8, taste: 1.7, output: 1.8 },
      0.6,
    ),
    minComparisons: 24,
    maxComparisons: null,
    focusDimensions: ["problem_solving", "learning_velocity", "agency", "taste", "output"],
  },
  {
    id: "p-bram",
    name: "Bram Okafor",
    affiliation: "Northgate Labs",
    bio: "Well-connected; frequently recommended.",
    referrals: [
      strong,
      { conviction: 5, confidence: 4, relationshipDepth: 3, evidenceType: "firsthand_personal" },
      { conviction: 4, confidence: 5, relationshipDepth: 4, evidenceType: "firsthand_work" },
      { conviction: 5, confidence: 3, relationshipDepth: 3, evidenceType: "artifact" },
    ],
    trueTheta: theta({}, 0),
    minComparisons: 18,
    maxComparisons: null,
    focusDimensions: ["problem_solving", "agency", "output", "taste"],
  },
  {
    id: "p-cleo",
    name: "Cleo Marsh",
    affiliation: "Unaffiliated",
    bio: "Quiet; almost nobody has heard of her.",
    referrals: [{ conviction: 2, confidence: 2, relationshipDepth: 1, evidenceType: "reputation" }],
    trueTheta: theta({}, 2.3),
    minComparisons: 24,
    maxComparisons: null,
    focusDimensions: ["problem_solving", "learning_velocity", "originality", "agency"],
  },
  {
    id: "p-dev",
    name: "Dev Raman",
    affiliation: "Harrow & Finch",
    bio: "One person is certain about him; nobody else has looked.",
    referrals: [
      { conviction: 5, confidence: 5, relationshipDepth: 5, evidenceType: "firsthand_work" },
    ],
    trueTheta: theta({}, 0.5),
    minComparisons: 1,
    maxComparisons: 2,
    focusDimensions: ["problem_solving"],
  },
  {
    id: "p-ember",
    name: "Ember Liu",
    affiliation: "Civic Data Collective",
    bio: "Knows everyone; many lukewarm recommendations.",
    referrals: [mediocre, mediocre, mediocre, mediocre, mediocre, mediocre],
    trueTheta: theta({}, 0),
    minComparisons: 8,
    maxComparisons: null,
    focusDimensions: ["agency", "output"],
  },
  {
    id: "p-fox",
    name: "Fox Delacroix",
    affiliation: "Independent",
    bio: "Formidable on hard problems; never observed leading others.",
    referrals: [
      { conviction: 3, confidence: 3, relationshipDepth: 3, evidenceType: "firsthand_work" },
      { conviction: 4, confidence: 3, relationshipDepth: 2, evidenceType: "artifact" },
    ],
    trueTheta: theta({ problem_solving: 1.9, generativity: null }, 0.3),
    minComparisons: 12,
    maxComparisons: null,
    focusDimensions: ["problem_solving"],
  },
];

export const PERSONA_IDS: readonly string[] = PERSONAS.map((p) => p.id);
