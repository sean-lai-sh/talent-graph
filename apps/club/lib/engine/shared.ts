/**
 * The few engine helpers that both the view side and the mutation side need.
 * Nothing here computes a score; it exists so `personView.ts` and
 * `transitions.ts` can share a name without either importing the other (or
 * `engine.ts`, which would close a cycle).
 */

import type { ClubState } from "../types.ts";

/** The signed-in council member when nobody else is named as evaluator. */
export const OWNER_EVALUATOR_ID = "example-admin";
export const OWNER_NAME = "Admin";

export function nameOf(state: ClubState, id: string): string {
  if (id === OWNER_EVALUATOR_ID) return OWNER_NAME;
  return state.people.find((p) => p.id === id)?.name ?? id;
}
