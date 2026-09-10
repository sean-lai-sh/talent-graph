"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { ClubBoard } from "../../components/ClubBoard";
import { api } from "../../convex/_generated/api";

/**
 * Real-org board. Inputs live in Convex; views come from lib/engine.ts → src/.
 * Only mount this under ConvexClientProvider when NEXT_PUBLIC_CONVEX_URL is set.
 */
export function PersistedClub() {
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

  if (board === undefined || board === null) {
    return <p className="mt-6 text-sm text-muted">Loading club from Convex…</p>;
  }

  return (
    <div className="mt-8 -mx-6">
      <ClubBoard
        initial={board}
        sync={board}
        variant="club"
        actions={{
          setNow: async (_state, now) => await setNow({ now }),
          setStatus: async (_state, personId, status) => await setStatus({ personId, status }),
          addReferral: async (_state, input) => await addReferral(input),
          meddleReferral: async (_state, referralId, patch) =>
            await meddleReferral({ referralId, ...patch }),
          addComparison: async (_state, input) => await addComparison(input),
          addPerson: async (_state, input) => await addPerson(input),
        }}
      />
    </div>
  );
}
