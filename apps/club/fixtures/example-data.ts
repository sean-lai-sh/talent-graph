/**
 * Static example rows for the public `/demo` shell.
 * Checked in. Not seeded into Convex. Not loaded from a query.
 * Names, ids, and phones are obviously fictional.
 */

export type ExampleMember = {
  id: string;
  name: string;
  email: string;
  phone: string;
  linkedin?: string;
};

export const EXAMPLE_MEMBERS: readonly ExampleMember[] = [
  {
    id: "example-ada",
    name: "Ada Example",
    email: "ada.example@example.test",
    phone: "+1-555-0100",
    linkedin: "https://example.test/in/ada.example",
  },
  {
    id: "example-bo",
    name: "Bo Fixture",
    email: "bo.fixture@example.test",
    phone: "+1-555-0101",
    linkedin: "https://example.test/in/bo.fixture",
  },
  {
    id: "example-cy",
    name: "Cy Sample",
    email: "cy.sample@example.test",
    phone: "+1-555-0102",
    linkedin: "https://example.test/in/cy.sample",
  },
  {
    id: "example-dee",
    name: "Dee Placeholder",
    email: "dee.placeholder@example.test",
    phone: "+1-555-0103",
  },
];

export const EXAMPLE_FORUM = {
  id: "example-post",
  authorId: "example-ada",
  createdAt: "2026-01-15T15:00:00.000Z",
} as const;
