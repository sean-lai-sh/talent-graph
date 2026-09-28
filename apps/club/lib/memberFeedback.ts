/**
 * Member feedback inbox. Listing and the response plan are pure so tests
 * can prove ownership without a Convex backend. A response is a
 * `recordFeedback` transition — the same evaluation the council records.
 */

import type { Dimension, RubricScore, Scale5 } from "../../../src/domain/types.ts";
import { recordFeedback } from "./engine.ts";
import { hoursLabel } from "./format.ts";
import { feedbackState, hoursUntil } from "./review.ts";
import { reviveState } from "./serialize.ts";
import type { ClubState, IsoDate } from "./types.ts";

export const OBSERVATION_REQUIRED = "Write what you observed.";
export const NOT_YOUR_REQUEST = "That request is not yours.";
export const REQUEST_CLOSED = "That request is already closed.";

export type FeedbackInboxItem = {
  id: string;
  candidateId: string;
  candidateName: string;
  note: string;
  requestedAt: IsoDate;
  dueAt: IsoDate;
  state: "pending" | "overdue";
  dueLabel: string;
};

export type FeedbackOrg = {
  key: string;
  state: ClubState;
};

export type MemberResponseDraft = {
  requestId: string;
  dimension: Dimension;
  score: RubricScore | null;
  confidence: Scale5 | null;
  evidenceText: string;
};

export type MemberResponsePlan = { key: string; state: ClubState } | { key: null; error: string };

export function normalizedEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

function personIdsForEmail(state: ClubState, email: string): Set<string> {
  const value = normalizedEmail(email);
  if (!value) return new Set();
  return new Set(
    state.people
      .filter((person) => normalizedEmail(person.email) === value)
      .map((person) => person.id),
  );
}

/** Open requests whose member row email is the signed-in account. */
export function listOwnFeedbackRequests(input: {
  orgs: readonly FeedbackOrg[];
  email: string;
  clock: IsoDate;
}): FeedbackInboxItem[] {
  const items: FeedbackInboxItem[] = [];
  for (const org of input.orgs) {
    const ids = personIdsForEmail(org.state, input.email);
    if (ids.size === 0) continue;
    const names = new Map(org.state.people.map((person) => [person.id, person.name]));
    for (const request of org.state.feedbackRequests) {
      if (request.respondedAt !== null || !ids.has(request.memberId)) continue;
      const state = feedbackState(request, input.clock);
      if (state === "responded") continue;
      items.push({
        id: request.id,
        candidateId: request.candidateId,
        candidateName: names.get(request.candidateId) ?? "Candidate",
        note: request.note,
        requestedAt: request.requestedAt,
        dueAt: request.dueAt,
        state,
        dueLabel: hoursLabel(hoursUntil(request.dueAt, input.clock)),
      });
    }
  }
  items.sort(
    (a, b) =>
      Number(a.state !== "overdue") - Number(b.state !== "overdue") ||
      a.dueAt.localeCompare(b.dueAt) ||
      a.id.localeCompare(b.id),
  );
  return items;
}

/** Empty observation copy for the form. The mutation repeats the check. */
export function memberResponseFormError(evidenceText: string): string | null {
  if (evidenceText.trim() === "") return OBSERVATION_REQUIRED;
  return null;
}

/**
 * Reject a request that is not this member's or is already closed, then
 * record the rubric evaluation through `recordFeedback`.
 */
export function prepareMemberResponse(input: {
  orgs: readonly FeedbackOrg[];
  email: string;
  response: MemberResponseDraft;
  now: IsoDate;
}): MemberResponsePlan {
  let sawSomeoneElse = false;
  for (const org of input.orgs) {
    const ids = personIdsForEmail(org.state, input.email);
    const request = org.state.feedbackRequests.find((row) => row.id === input.response.requestId);
    if (!request) continue;
    if (!ids.has(request.memberId)) {
      sawSomeoneElse = true;
      continue;
    }
    if (request.respondedAt !== null) return { key: null, error: REQUEST_CLOSED };
    const stamped = reviveState(org.state);
    stamped.now = input.now;
    const result = recordFeedback(stamped, {
      requestId: request.id,
      evaluatorId: request.memberId,
      candidateId: request.candidateId,
      dimension: input.response.dimension,
      score: input.response.score,
      confidence: input.response.score === null ? null : input.response.confidence,
      evidenceText: input.response.evidenceText,
    });
    if (result.error) return { key: null, error: result.error };
    return { key: org.key, state: result.state };
  }
  if (sawSomeoneElse) return { key: null, error: NOT_YOUR_REQUEST };
  return { key: null, error: NOT_YOUR_REQUEST };
}
