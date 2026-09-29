/**
 * `/demo/home` Ladder, built from the public seed in memory.
 * No Convex. The same placement function the member mutation calls.
 */

import type { Dimension } from "../../../../src/domain/types.ts";
import { addReferral, initialState } from "../../lib/engine.ts";
import {
  commitLadderPlacement,
  type LadderPlacement,
  type LadderStepView,
  openComparisonStep,
} from "../../lib/ladderPlacement.ts";
import type { ClubState } from "../../lib/types.ts";

export const PREVIEW_REFERRER_EMAIL = "preview.referrer@example.test";

export type PreviewBundle = {
  state: ClubState;
  email: string;
  applicantId: string;
  view: LadderStepView;
};

function referrerWithMost(state: ClubState): string | null {
  const counts = new Map<string, number>();
  for (const referral of state.referrals) {
    counts.set(referral.referrerId, (counts.get(referral.referrerId) ?? 0) + 1);
  }
  let best: { id: string; count: number } | null = null;
  for (const [id, count] of counts) {
    const person = state.people.find((row) => row.id === id);
    if (person?.status !== "member") continue;
    if (!best || count > best.count || (count === best.count && id < best.id)) {
      best = { id, count };
    }
  }
  return best?.id ?? null;
}

function withReferral(state: ClubState, referrerId: string, candidateId: string): ClubState {
  const result = addReferral(state, {
    referrerId,
    candidateId,
    conviction: 3,
    confidence: 3,
    relationshipDepth: 3,
    evidenceType: "firsthand_work",
    evidenceText: "Example preview. Not a real observation.",
  });
  if (result.error !== undefined) return state;
  return result.state;
}

export function startPreview(applicantId: string, name: string): PreviewBundle | { error: string } {
  const seed = initialState();
  const referrerId = referrerWithMost(seed);
  if (!referrerId) return { error: "The example seed has no referrer." };
  const now = seed.now;
  let state: ClubState = {
    ...seed,
    people: [
      ...seed.people.map((person) =>
        person.id === referrerId ? { ...person, email: PREVIEW_REFERRER_EMAIL } : person,
      ),
      {
        id: applicantId,
        name,
        status: "candidate",
        reviewStatus: "new",
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  const already = new Set(
    state.referrals
      .filter((referral) => referral.referrerId === referrerId)
      .map((referral) => referral.candidateId),
  );
  if (already.size < 2) {
    for (const person of state.people) {
      if (already.size >= 4) break;
      if (person.id === referrerId || person.id === applicantId || already.has(person.id)) continue;
      state = withReferral(state, referrerId, person.id);
      already.add(person.id);
    }
  }
  state = withReferral(state, referrerId, applicantId);
  const opened = openComparisonStep({
    session: { email: PREVIEW_REFERRER_EMAIL },
    ownedPersonIds: [applicantId],
    state,
    personId: applicantId,
  });
  if (!opened.ok) return { error: opened.error };
  return { state, email: PREVIEW_REFERRER_EMAIL, applicantId, view: opened.view };
}

export function placePreview(
  bundle: PreviewBundle,
  dimension: Dimension,
  placement: LadderPlacement,
): { ok: true; bundle: PreviewBundle } | { ok: false; error: string } {
  const result = commitLadderPlacement({
    session: { email: bundle.email },
    ownedPersonIds: [bundle.applicantId],
    state: bundle.state,
    personId: bundle.applicantId,
    dimension,
    placement,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, bundle: { ...bundle, state: result.state } };
}
