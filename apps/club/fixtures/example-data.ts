/**
 * Raw inputs for the public `/demo` board.
 * Checked in. Not seeded into Convex. Not loaded from a query.
 *
 * People, referrals, admit/deny decisions, and comparison evidence only.
 * No judge weight, no referral signal, no capability percentile, no rubric score.
 * Those numbers are whatever the scoring engine computes from this file.
 */

const AT = "2026-06-01T00:00:00.000Z";

export type ExamplePerson = {
  id: string;
  name: string;
  email: string;
  phone: string;
  linkedin?: string;
  affiliation: string;
  status: "candidate" | "member" | "archived";
  /** Council decision. admitted and denied are decisions, not scores. */
  reviewStatus: "new" | "under_review" | "needs_data" | "admitted" | "denied";
  createdAt: string;
  updatedAt: string;
};

export type ExampleReferral = {
  id: string;
  referrerId: string;
  candidateId: string;
  /** The referrer's own 1–5 answer. Not a computed weight. */
  conviction: 1 | 2 | 3 | 4 | 5;
  confidence: 1 | 2 | 3 | 4 | 5;
  relationshipDepth: 1 | 2 | 3 | 4 | 5;
  evidenceType: "firsthand_work" | "firsthand_personal" | "artifact" | "reputation" | "other";
  evidenceText: string;
  createdAt: string;
  updatedAt: string;
};

export type ExampleComparison = {
  id: string;
  evaluatorId: string;
  personAId: string;
  personBId: string;
  dimension: "problem_solving" | "agency" | "output";
  outcome: "a" | "b" | "tie" | "skip" | "insufficient_observation";
  winnerId: string | null;
  confidence: 1 | 2 | 3 | 4 | 5 | null;
  evidenceText: string;
  createdAt: string;
};

export const EXAMPLE_PEOPLE: readonly ExamplePerson[] = [
  {
    id: "example-ada",
    name: "Ada Example",
    email: "ada.example@example.test",
    phone: "+1-555-0100",
    linkedin: "https://example.test/in/ada.example",
    affiliation: "Example Lab",
    status: "member",
    reviewStatus: "admitted",
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "example-bo",
    name: "Bo Fixture",
    email: "bo.fixture@example.test",
    phone: "+1-555-0101",
    affiliation: "Fixture Workshop",
    status: "member",
    reviewStatus: "admitted",
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "example-cy",
    name: "Cy Sample",
    email: "cy.sample@example.test",
    phone: "+1-555-0102",
    linkedin: "https://example.test/in/cy.sample",
    affiliation: "Sample Studio",
    status: "candidate",
    reviewStatus: "under_review",
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "example-dee",
    name: "Dee Placeholder",
    email: "dee.placeholder@example.test",
    phone: "+1-555-0103",
    affiliation: "Placeholder Co",
    status: "candidate",
    reviewStatus: "new",
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "example-eve",
    name: "Eve Example",
    email: "eve.example@example.test",
    phone: "+1-555-0104",
    linkedin: "https://example.test/in/eve.example",
    affiliation: "Example Lab",
    status: "member",
    reviewStatus: "admitted",
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "example-fay",
    name: "Fay Fixture",
    email: "fay.fixture@example.test",
    phone: "+1-555-0105",
    affiliation: "Fixture Workshop",
    status: "archived",
    reviewStatus: "denied",
    createdAt: AT,
    updatedAt: AT,
  },
];

export const EXAMPLE_REFERRALS: readonly ExampleReferral[] = [
  {
    id: "example-ref-cy-ada",
    referrerId: "example-ada",
    candidateId: "example-cy",
    conviction: 5,
    confidence: 4,
    relationshipDepth: 4,
    evidenceType: "firsthand_work",
    evidenceText: "Example observation. Ada worked with Cy on a made-up project.",
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "example-ref-cy-bo",
    referrerId: "example-bo",
    candidateId: "example-cy",
    conviction: 2,
    confidence: 3,
    relationshipDepth: 2,
    evidenceType: "reputation",
    evidenceText: "Example observation. Bo has only heard about Cy.",
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "example-ref-dee-ada",
    referrerId: "example-ada",
    candidateId: "example-dee",
    conviction: 3,
    confidence: 3,
    relationshipDepth: 3,
    evidenceType: "firsthand_personal",
    evidenceText: "Example observation. Ada knows Dee outside of work.",
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "example-ref-eve-bo",
    referrerId: "example-bo",
    candidateId: "example-eve",
    conviction: 4,
    confidence: 4,
    relationshipDepth: 3,
    evidenceType: "firsthand_work",
    evidenceText: "Example observation. Bo shipped a made-up project with Eve.",
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "example-ref-fay-ada",
    referrerId: "example-ada",
    candidateId: "example-fay",
    conviction: 1,
    confidence: 2,
    relationshipDepth: 1,
    evidenceType: "other",
    evidenceText: "Example observation. Ada has almost no basis for Fay.",
    createdAt: AT,
    updatedAt: AT,
  },
];

export const EXAMPLE_COMPARISONS: readonly ExampleComparison[] = [
  {
    id: "example-cmp-1",
    evaluatorId: "example-ada",
    personAId: "example-cy",
    personBId: "example-dee",
    dimension: "problem_solving",
    outcome: "a",
    winnerId: "example-cy",
    confidence: 4,
    evidenceText: "Example comparison. Ada ranked Cy ahead of Dee.",
    createdAt: AT,
  },
  {
    id: "example-cmp-2",
    evaluatorId: "example-bo",
    personAId: "example-cy",
    personBId: "example-fay",
    dimension: "problem_solving",
    outcome: "a",
    winnerId: "example-cy",
    confidence: 3,
    evidenceText: "Example comparison. Bo ranked Cy ahead of Fay.",
    createdAt: AT,
  },
  {
    id: "example-cmp-3",
    evaluatorId: "example-ada",
    personAId: "example-eve",
    personBId: "example-dee",
    dimension: "agency",
    outcome: "a",
    winnerId: "example-eve",
    confidence: 4,
    evidenceText: "Example comparison. Ada ranked Eve ahead of Dee.",
    createdAt: AT,
  },
  {
    id: "example-cmp-4",
    evaluatorId: "example-bo",
    personAId: "example-eve",
    personBId: "example-fay",
    dimension: "output",
    outcome: "b",
    winnerId: "example-fay",
    confidence: 2,
    evidenceText: "Example comparison. Bo ranked Fay ahead of Eve on output.",
    createdAt: AT,
  },
];

export const EXAMPLE_FORUM = {
  id: "example-post",
  authorId: "example-ada",
  createdAt: "2026-01-15T15:00:00.000Z",
} as const;
