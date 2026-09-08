/**
 * The six intentionally interesting cases from the MVP prompt §30 — display
 * data only (id, name, affiliation, bio).
 *
 * The generator-only shape of each persona (referral shapes, hidden ability,
 * comparison bounds) lives in `personaShapes.ts`, which is deliberately not
 * re-exported from the public barrel: the hidden ability exists to give
 * Bradley–Terry a known ordering to recover, and nothing outside the
 * generator may read it.
 */

export interface PersonaProfile {
  id: string;
  name: string;
  affiliation: string;
  bio: string;
}

export const PERSONA_PROFILES: readonly PersonaProfile[] = [
  {
    id: "p-alice",
    name: "Alice Tanaka",
    affiliation: "Independent",
    bio: "Systems engineer; rebuilt a payments core from the ground up.",
  },
  {
    id: "p-bram",
    name: "Bram Okafor",
    affiliation: "Northgate Labs",
    bio: "Well-connected; frequently recommended.",
  },
  {
    id: "p-cleo",
    name: "Cleo Marsh",
    affiliation: "Unaffiliated",
    bio: "Quiet; almost nobody has heard of her.",
  },
  {
    id: "p-dev",
    name: "Dev Raman",
    affiliation: "Harrow & Finch",
    bio: "One person is certain about him; nobody else has looked.",
  },
  {
    id: "p-ember",
    name: "Ember Liu",
    affiliation: "Civic Data Collective",
    bio: "Knows everyone; many lukewarm recommendations.",
  },
  {
    id: "p-fox",
    name: "Fox Delacroix",
    affiliation: "Independent",
    bio: "Formidable on hard problems; never observed leading others.",
  },
];

export const PERSONA_IDS: readonly string[] = PERSONA_PROFILES.map((p) => p.id);
