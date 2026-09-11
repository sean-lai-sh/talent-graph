"use client";

import { useMemo, useState } from "react";
import type { PersonStatus } from "../../../src/domain/types.ts";
import type { ClubBoardActions, EngineResult, PersonView } from "../lib/types.ts";
import { BoardError, BoardHeader } from "./board/BoardHeader.tsx";
import { CandidateQueue } from "./board/CandidateQueue.tsx";
import { DecisionCard } from "./board/DecisionCard.tsx";
import { nextQueueId, type SortChip, sortByChip } from "./board/readiness.ts";
import { useClubSession } from "./board/useClubSession.ts";

const TABS: { id: PersonStatus; label: string }[] = [
  { id: "candidate", label: "Candidates" },
  { id: "member", label: "Members" },
  { id: "archived", label: "Archived" },
];

const CHIPS: { id: SortChip; label: string }[] = [
  { id: "loudest", label: "Loudest" },
  { id: "evidence", label: "Most evidence" },
  { id: "underRecognized", label: "Under-recognized" },
  { id: "newest", label: "Newest" },
];

export function ClubBoard({
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
  const session = useClubSession({ initial, variant, actions, sync });
  const { view, selected, selectedId, setSelectedId, pending, mutate, run } = session;
  const [tab, setTab] = useState<PersonStatus>("candidate");
  const [chip, setChip] = useState<SortChip>("loudest");

  const queue = useMemo(
    () =>
      sortByChip(
        view.people.filter((p) => p.status === tab),
        chip,
        session.createdAtById,
      ),
    [view.people, tab, chip, session.createdAtById],
  );

  const changeStatus = (person: PersonView, status: PersonStatus) => {
    if (person.status === tab && status !== tab) {
      session.queueAfterStatus(nextQueueId(queue, person.id));
    }
    mutate((latest) => run.setStatus(latest, person.id, status));
  };

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <BoardHeader
        variant={variant}
        surface="review"
        view={view}
        dirty={session.dirty}
        newPersonName={session.newPersonName}
        onNewPersonName={variant === "club" && run.addPerson ? session.setNewPersonName : undefined}
        onAddPerson={
          variant === "club" && run.addPerson
            ? () => {
                const name = session.newPersonName.trim();
                if (!name || !run.addPerson) return;
                mutate(async (latest) => {
                  const result = await run.addPerson?.(latest, { name });
                  if (!result) return { state: latest, view };
                  if (!result.error) {
                    const created = result.state.people.find(
                      (p) => !latest.people.some((row) => row.id === p.id),
                    );
                    if (created) {
                      setTab(created.status);
                      setSelectedId(created.id);
                    }
                  }
                  return result;
                });
                session.setNewPersonName("");
              }
            : undefined
        }
        onReset={run.reset ? session.resetToSeed : undefined}
      />
      {session.error ? (
        <BoardError
          error={session.error}
          onDismiss={() => session.setError(null)}
          onReset={run.reset ? session.resetToSeed : undefined}
        />
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 sm:gap-4 sm:p-4 lg:grid-cols-[minmax(18rem,26rem)_1fr] lg:items-stretch">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex rounded-lg border border-line bg-panel p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
                  tab === t.id ? "bg-ink text-paper" : "text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChip(c.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] ${
                  chip === c.id
                    ? "bg-ink text-paper"
                    : "border border-line bg-panel text-muted hover:text-ink"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <CandidateQueue
            title={TABS.find((t) => t.id === tab)?.label ?? "Candidates"}
            people={queue}
            selectedId={selectedId}
            onSelect={setSelectedId}
            empty={`No ${tab === "candidate" ? "candidates" : `${tab} people`} in this club.`}
          />
        </div>

        <section className="rounded-lg border border-line bg-panel p-4 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
          {selected ? (
            <DecisionCard
              key={`${selected.id}:${session.dossierEpoch}`}
              person={selected}
              busy={pending}
              referrers={session.referrers}
              snapshots={view.snapshots}
              internalsMode="details"
              onStatus={(status) => changeStatus(selected, status)}
              onMeddle={(id, patch) => mutate((latest) => run.meddleReferral(latest, id, patch))}
              onRefer={(input) => mutate((latest) => run.addReferral(latest, input))}
            />
          ) : (
            <p className="text-sm text-muted">
              {variant === "club"
                ? "Nobody is selected. Add a person to start this club."
                : "Nobody is selected. Pick a row, or reset to seed to open Cleo."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
