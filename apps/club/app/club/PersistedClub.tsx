"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { ClubBoard } from "../../components/ClubBoard";
import { api } from "../../convex/_generated/api";

/**
 * Real-org council page. Inputs live in Convex; views come from lib/engine.ts → src/.
 * Only mount this under <Authenticated> after convexConfigured() is true.
 * Org is keyed by the Better Auth owner — not a membership / invite model.
 *
 * `api.club.setStatus` and `api.club.addReferral` exist for other pages; the
 * council page decides through `api.club.decide`.
 */
export function PersistedClub() {
  const board = useQuery(api.club.getBoard);
  const ensure = useMutation(api.club.ensureOrganization);
  const addPerson = useMutation(api.club.addPerson);
  const decide = useMutation(api.club.decide);
  const requestFeedback = useMutation(api.club.requestFeedback);
  const recordFeedback = useMutation(api.club.recordFeedback);
  const setReviewConfig = useMutation(api.club.setReviewConfig);

  useEffect(() => {
    void ensure({});
  }, [ensure]);

  if (board === undefined) {
    return <p className="mt-6 text-sm text-muted">Loading club from Convex…</p>;
  }

  if (board === null) {
    return (
      <div className="mt-6 max-w-xl">
        <p className="text-sm text-muted">No organization yet.</p>
        <button
          className="press mt-3 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-subtle"
          type="button"
          onClick={() => void ensure({})}
        >
          Create club
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 -mx-6">
      <ClubBoard
        initial={board}
        sync={board}
        variant="club"
        clock="wall"
        actions={{
          decide: async (_state, personId, decision) => await decide({ personId, decision }),
          requestFeedback: async (_state, input) => await requestFeedback(input),
          recordFeedback: async (_state, input) => await recordFeedback(input),
          setReviewConfig: async (_state, input) => await setReviewConfig(input),
          addPerson: async (_state, input) => await addPerson(input),
        }}
      />
    </div>
  );
}
