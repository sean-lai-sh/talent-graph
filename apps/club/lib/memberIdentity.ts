/**
 * The one link from a signed-in account to an engine person.
 * Normalized email equals `clubPeople.email` on exactly one person with
 * status `member`. Zero matches or more than one match are not linked.
 */

import type { ClubState } from "./types.ts";

export type MemberPersonLink = { status: "linked"; personId: string } | { status: "not_linked" };

function normalizedEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

export function resolveMemberPersonId(state: ClubState, email: string): MemberPersonLink {
  const wanted = normalizedEmail(email);
  if (wanted === "") return { status: "not_linked" };
  const matches = state.people.filter(
    (person) => person.status === "member" && normalizedEmail(person.email) === wanted,
  );
  const only = matches.length === 1 ? matches[0] : undefined;
  if (!only) return { status: "not_linked" };
  return { status: "linked", personId: only.id };
}

/** More than one member row carries this email, so no single profile can be chosen. */
export function memberEmailIsAmbiguous(state: ClubState, email: string): boolean {
  const wanted = normalizedEmail(email);
  if (wanted === "") return false;
  const matches = state.people.filter(
    (person) => person.status === "member" && normalizedEmail(person.email) === wanted,
  );
  return matches.length > 1;
}
