"use client";

import { useCallback, useEffect, useState } from "react";
import type { PersonStatus } from "../../../src/domain/types.ts";
import type { ClubBoardActions, EngineResult, PersonView } from "../lib/types.ts";
import { BoardError, BoardHeader } from "./board/BoardHeader.tsx";
import { CandidateQueue } from "./board/CandidateQueue.tsx";
import { DecisionCard } from "./board/DecisionCard.tsx";
import { nextQueueId, sortByReadiness } from "./board/readiness.ts";
import { useClubSession } from "./board/useClubSession.ts";

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
  const { view, selected, selectedId, setSelectedId, pending, mutate, run, queueAfterStatus } =
    session;
  const [showMath, setShowMath] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);

  const queue = sortByReadiness(view.people.filter((p) => p.status === "candidate"));

  const changeStatus = useCallback(
    (person: PersonView, status: PersonStatus) => {
      if (status === "member" || status === "archived") {
        queueAfterStatus(nextQueueId(queue, person.id));
      }
      mutate((latest) => run.setStatus(latest, person.id, status));
    },
    [mutate, queue, queueAfterStatus, run],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key;
      if (key === "j" || key === "ArrowDown") {
        event.preventDefault();
        const i = queue.findIndex((p) => p.id === selectedId);
        const next = queue[i + 1] ?? queue[0];
        if (next) {
          setReferralOpen(false);
          setSelectedId(next.id);
        }
        return;
      }
      if (key === "k" || key === "ArrowUp") {
        event.preventDefault();
        const i = queue.findIndex((p) => p.id === selectedId);
        const prev = queue[i - 1] ?? queue[queue.length - 1];
        if (prev) {
          setReferralOpen(false);
          setSelectedId(prev.id);
        }
        return;
      }
      if (key === "a" && selected && selected.status !== "member") {
        event.preventDefault();
        changeStatus(selected, "member");
        return;
      }
      if (key === "x" && selected && selected.status !== "archived") {
        event.preventDefault();
        changeStatus(selected, "archived");
        return;
      }
      if (key === "r") {
        event.preventDefault();
        setReferralOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue, selected, selectedId, setSelectedId, changeStatus]);

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink lg:h-screen lg:overflow-hidden">
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
                    if (created) setSelectedId(created.id);
                  }
                  return result;
                });
                session.setNewPersonName("");
              }
            : undefined
        }
        onReset={run.reset ? session.resetToSeed : undefined}
        extra={
          <label className="flex items-center gap-1.5 text-xs text-ink">
            <input
              type="checkbox"
              className="accent-ink"
              checked={showMath}
              onChange={(e) => setShowMath(e.target.checked)}
            />
            Show the math
          </label>
        }
      />
      {session.error ? (
        <BoardError
          error={session.error}
          onDismiss={() => session.setError(null)}
          onReset={run.reset ? session.resetToSeed : undefined}
        />
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 sm:gap-4 sm:p-4 lg:grid-cols-[minmax(18rem,26rem)_1fr] lg:items-stretch lg:overflow-hidden">
        <div className="flex min-h-0 flex-col lg:overflow-hidden">
          <CandidateQueue
            title="Candidates"
            people={queue}
            selectedId={selectedId}
            onSelect={(id) => {
              setReferralOpen(false);
              setSelectedId(id);
            }}
            showMath={showMath}
            empty="No candidates in this club."
          />
          <p className="mt-2 px-1 text-[11px] text-muted">
            j/k or ↑/↓ move · a accept · x archive · r write a referral
          </p>
        </div>

        <section className="rounded-lg border border-line bg-panel p-4 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
          {selected ? (
            <DecisionCard
              key={`${selected.id}:${session.dossierEpoch}`}
              person={selected}
              busy={pending}
              referrers={session.referrers}
              snapshots={view.snapshots}
              internalsMode={showMath ? "expanded" : "hidden"}
              referralOpen={referralOpen}
              onReferralOpenChange={setReferralOpen}
              onStatus={(status) => changeStatus(selected, status)}
              onMeddle={(id, patch) => mutate((latest) => run.meddleReferral(latest, id, patch))}
              onRefer={(input) => mutate((latest) => run.addReferral(latest, input))}
            />
          ) : (
            <p className="text-sm text-muted">
              {variant === "club"
                ? "Nobody is selected. Add a person to start this club."
                : "Nobody is selected. Pick a candidate, or reset to seed to open Cleo."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
