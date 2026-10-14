/**
 * Public `/demo` display data. Built from the in-memory seed only.
 * Never calls Convex. Never attaches a phone, a judge weight, or a referrer.
 */

import { EXAMPLE_FORUM_BODY, UNKNOWN_VALUE } from "./copy.ts";
import { type DirectoryMember, directoryEmail, toDirectoryMembers } from "./memberDirectory.ts";
import type { ShellPane } from "./shellNav.ts";

type NamedPerson = {
  id: string;
  name: string;
  status: string;
  email?: string;
  linkedin?: string;
};

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

/** Local part of the directory address, always at @example.test. */
export function exampleEmail(name: string): string {
  const base = directoryEmail(name);
  const local = base.split("@")[0]?.trim() || "member";
  return `${local}@example.test`;
}

export function exampleName(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : UNKNOWN_VALUE;
}

/**
 * Admitted people, as the member list shows them: name, LinkedIn, email.
 * Emails are rewritten to @example.test. LinkedIn points at example.test,
 * never a linkedin.com profile that could belong to a real person.
 */
export function exampleMembers(people: readonly NamedPerson[]): DirectoryMember[] {
  return toDirectoryMembers(people).map((member) => {
    const name = exampleName(member.name);
    const row: DirectoryMember = {
      id: member.id,
      name,
      email: exampleEmail(name === UNKNOWN_VALUE ? "member" : name),
    };
    if (member.linkedin?.trim() && name !== UNKNOWN_VALUE) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.|\.$/g, "");
      row.linkedin = `https://example.test/in/${slug || "member"}`;
    }
    return row;
  });
}

export type ExamplePost = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
};

export function exampleForumSeed(authorName: string): ExamplePost {
  return {
    id: "example-post",
    body: EXAMPLE_FORUM_BODY,
    authorName: exampleName(authorName),
    createdAt: "2026-01-15T15:00:00.000Z",
  };
}
