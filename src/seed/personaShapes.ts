/**
 * Generator-only shape of the six personas: which referrals to fabricate,
 * how many comparisons to produce, and the hidden ability that samples the
 * comparison outcomes.
 *
 * INTERNAL to `src/seed/`. Not re-exported from `src/index.ts`. `trueTheta`
 * is the hidden ability used only to *sample* comparison outcomes in the
 * generator; it is never written into the dataset and no algorithm reads it.
 * Its only purpose is to give Bradley–Terry a known ordering to recover.
 */

import type { Dimension, EvidenceType, Scale5 } from "../domain/types.ts";
import { PERSONA_PROFILES, type PersonaProfile } from "./personas.ts";

export interface PersonaReferralShape {
  conviction: Scale5;
  confidence: Scale5;
  relationshipDepth: Scale5;
  evidenceType: EvidenceType;
}

export interface PersonaShape {
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

/** Profile plus generator shape, as the generator consumes it. */
export type Persona = PersonaProfile & PersonaShape;

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

const SHAPES: Readonly<Record<string, PersonaShape>> = {
  "p-alice": {
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
  "p-bram": {
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
  "p-cleo": {
    referrals: [{ conviction: 2, confidence: 2, relationshipDepth: 1, evidenceType: "reputation" }],
    trueTheta: theta({}, 2.3),
    minComparisons: 24,
    maxComparisons: null,
    focusDimensions: ["problem_solving", "learning_velocity", "originality", "agency"],
  },
  "p-dev": {
    referrals: [
      { conviction: 5, confidence: 5, relationshipDepth: 5, evidenceType: "firsthand_work" },
    ],
    trueTheta: theta({}, 0.5),
    minComparisons: 1,
    maxComparisons: 2,
    focusDimensions: ["problem_solving"],
  },
  "p-ember": {
    referrals: [mediocre, mediocre, mediocre, mediocre, mediocre, mediocre],
    trueTheta: theta({}, 0),
    minComparisons: 8,
    maxComparisons: null,
    focusDimensions: ["agency", "output"],
  },
  "p-fox": {
    referrals: [
      { conviction: 3, confidence: 3, relationshipDepth: 3, evidenceType: "firsthand_work" },
      { conviction: 4, confidence: 3, relationshipDepth: 2, evidenceType: "artifact" },
    ],
    trueTheta: theta({ problem_solving: 1.9, generativity: null }, 0.3),
    minComparisons: 12,
    maxComparisons: null,
    focusDimensions: ["problem_solving"],
  },
};

/** Every persona with its generator shape, in the order of `PERSONA_PROFILES`. */
export const PERSONAS: readonly Persona[] = PERSONA_PROFILES.map((profile) => {
  const shape = SHAPES[profile.id];
  if (shape === undefined) throw new Error(`persona ${profile.id} has no generator shape`);
  return { ...profile, ...shape };
});
