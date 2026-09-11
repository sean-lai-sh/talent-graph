"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { describeActionError } from "../../lib/actionError.ts";
import { resolveBoardActions } from "../../lib/clubActions.ts";
import { defaultPersonasOnly } from "../../lib/graphLayout.ts";
import type {
  ClubBoardActions,
  ClubState,
  ClubView,
  EngineResult,
  PersonView,
} from "../../lib/types.ts";

export function useClubSession({
  initial,
  variant = "example",
  actions,
  sync,
}: {
  initial: EngineResult;
  variant?: "example" | "club";
  actions?: Partial<ClubBoardActions>;
  sync?: EngineResult | null;
}) {
  const run: ClubBoardActions = resolveBoardActions(variant, actions);
  const firstId =
    initial.view.people.find((p) => p.id === "p-cleo")?.id ?? initial.view.people[0]?.id ?? "";
  const [state, setState] = useState<ClubState>(initial.state);
  const [view, setView] = useState<ClubView>(initial.view);
  const [error, setError] = useState<string | null>(initial.error ?? null);
  const [selectedId, setSelectedId] = useState<string>(firstId);
  const [personasOnly, setPersonasOnly] = useState(defaultPersonasOnly(variant));
  const [dossierEpoch, setDossierEpoch] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [pending, start] = useTransition();
  const stateRef = useRef(state);
  const chainRef = useRef(Promise.resolve());
  const nextAfterActionRef = useRef<string | null>(null);

  const apply = (result: EngineResult) => {
    setState(result.state);
    setView(result.view);
    setError(result.error ?? null);
    stateRef.current = result.state;
    setSelectedId((id) => {
      const forced = nextAfterActionRef.current;
      if (forced !== null) {
        nextAfterActionRef.current = null;
        if (forced === "" || result.view.people.some((p) => p.id === forced)) return forced;
      }
      return result.view.people.some((p) => p.id === id) ? id : (result.view.people[0]?.id ?? "");
    });
  };

  useEffect(() => {
    if (!sync) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Convex hydrate, same as the previous ClubBoard
    setState(sync.state);
    setView(sync.view);
    setError(sync.error ?? null);
    stateRef.current = sync.state;
    setSelectedId((id) =>
      sync.view.people.some((p) => p.id === id) ? id : (sync.view.people[0]?.id ?? ""),
    );
  }, [sync]);

  const mutate = (fn: (latest: ClubState) => Promise<EngineResult>, opts?: { seed?: boolean }) => {
    chainRef.current = chainRef.current
      .then(async () => {
        const result = await fn(stateRef.current);
        apply(result);
        if (opts?.seed) setDirty(false);
        else if (!result.error) setDirty(true);
      })
      .catch((err: unknown) => {
        setError(describeActionError(err));
      });
    start(async () => {
      try {
        await chainRef.current;
      } catch (err) {
        setError(describeActionError(err));
      }
    });
  };

  const resetToSeed = () => {
    if (!run.reset) return;
    mutate(
      async () => {
        const result = await run.reset?.();
        if (!result) return { state: stateRef.current, view };
        setSelectedId("p-cleo");
        setDossierEpoch((n) => n + 1);
        return result;
      },
      { seed: true },
    );
  };

  const selected: PersonView | undefined = useMemo(
    () => (selectedId ? view.people.find((p) => p.id === selectedId) : undefined),
    [view.people, selectedId],
  );

  const referrers = view.people.filter((p) => p.id !== selected?.id);
  const createdAtById = useMemo(
    () => new Map(state.people.map((p) => [p.id, p.createdAt])),
    [state.people],
  );

  return {
    run,
    state,
    view,
    error,
    setError,
    selectedId,
    setSelectedId,
    selected,
    referrers,
    createdAtById,
    personasOnly,
    setPersonasOnly,
    dossierEpoch,
    dirty,
    newPersonName,
    setNewPersonName,
    pending,
    mutate,
    resetToSeed,
    queueAfterStatus: (nextId: string) => {
      nextAfterActionRef.current = nextId;
    },
  };
}
