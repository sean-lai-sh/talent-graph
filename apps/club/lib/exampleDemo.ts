/**
 * Public `/demo` display helpers. Member rows come from the static fixture.
 * Never calls Convex. Never attaches a judge weight or a referrer.
 */

import { EXAMPLE_FORUM, EXAMPLE_MEMBERS } from "../fixtures/example-data.ts";
import { EXAMPLE_FORUM_BODY, UNKNOWN_VALUE } from "./copy.ts";
import type { DirectoryMember } from "./memberDirectory.ts";
import type { ShellPane } from "./shellNav.ts";

const DEMO_PANES: readonly ShellPane[] = [
  "council",
  "forum",
  "referral",
  "members",
  "evaluations",
  "events",
];

export type DemoRoute = { pane: ShellPane; settings: boolean };

/** Hash on `/demo`. Unknown hashes stay on the council board. */
export function parseDemoHash(hash: string): DemoRoute {
  const id = hash.replace(/^#/, "").trim();
  if (id === "settings") return { pane: "council", settings: true };
  if ((DEMO_PANES as readonly string[]).includes(id)) {
    return { pane: id as ShellPane, settings: false };
  }
  return { pane: "council", settings: false };
}

export function demoHashFor(pane: ShellPane): string {
  return pane === "council" ? "" : `#${pane}`;
}

export function exampleName(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : UNKNOWN_VALUE;
}

/** Fixture members, in file order. Names, not ids. Phone is the fictional number. */
export function exampleDirectory(): DirectoryMember[] {
  return EXAMPLE_MEMBERS.map((member) => {
    const name = exampleName(member.name);
    const row: DirectoryMember = {
      id: member.id,
      name,
      email: member.email,
      phone: member.phone,
    };
    if (member.linkedin?.trim() && name !== UNKNOWN_VALUE) row.linkedin = member.linkedin.trim();
    return row;
  });
}

export type ExamplePost = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
};

export function exampleForumPost(): ExamplePost {
  const author = EXAMPLE_MEMBERS.find((member) => member.id === EXAMPLE_FORUM.authorId);
  return {
    id: EXAMPLE_FORUM.id,
    body: EXAMPLE_FORUM_BODY,
    authorName: exampleName(author?.name),
    createdAt: EXAMPLE_FORUM.createdAt,
  };
}
