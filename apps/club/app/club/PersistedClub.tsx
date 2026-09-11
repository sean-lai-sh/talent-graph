"use client";

import { useMutation, useQuery } from "convex/react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ClubBoard } from "../../components/ClubBoard";
import { ClubLab } from "../../components/ClubLab";
import { api } from "../../convex/_generated/api";
import type { ClubBoardActions } from "../../lib/types.ts";

/**
 * Real-org board. Inputs live in Convex; views come from lib/engine.ts → src/.
 * Only mount this under <Authenticated> after convexConfigured() is true.
 * Org is keyed by the Better Auth owner — not a membership / invite model.
 */
export function PersistedClub() {
  const pathname = usePathname();
  const surface = pathname?.includes("/lab") ? "lab" : "review";
  const board = useQuery(api.club.getBoard);
  const ensure = useMutation(api.club.ensureOrganization);
  const addPerson = useMutation(api.club.addPerson);
  const setStatus = useMutation(api.club.setStatus);
  const addReferral = useMutation(api.club.addReferral);
  const meddleReferral = useMutation(api.club.meddleReferral);
  const addComparison = useMutation(api.club.addComparison);
  const setNow = useMutation(api.club.setNow);

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
          className="mt-3 rounded border border-line px-3 py-1.5 text-sm hover:bg-paper"
          type="button"
          onClick={() => void ensure({})}
        >
          Create club
        </button>
      </div>
    );
  }

  const actions: Partial<ClubBoardActions> = {
    setNow: async (_state, now) => await setNow({ now }),
    setStatus: async (_state, personId, status) => await setStatus({ personId, status }),
    addReferral: async (_state, input) => await addReferral(input),
    meddleReferral: async (_state, referralId, patch) =>
      await meddleReferral({ referralId, ...patch }),
    addComparison: async (_state, input) => await addComparison(input),
    addPerson: async (_state, input) => await addPerson(input),
  };

  return (
    <div className="mt-8 -mx-6">
      {surface === "lab" ? (
        <ClubLab initial={board} sync={board} variant="club" actions={actions} />
      ) : (
        <ClubBoard initial={board} sync={board} variant="club" actions={actions} />
      )}
    </div>
  );
}
