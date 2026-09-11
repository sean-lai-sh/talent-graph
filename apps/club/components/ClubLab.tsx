"use client";

import { PRODUCT_LANGUAGE } from "../../../src/domain/constants.ts";
import type { ClubBoardActions, EngineResult } from "../lib/types.ts";
import { BoardError, BoardHeader } from "./board/BoardHeader.tsx";
import { ComparePanel } from "./board/ComparePanel.tsx";
import { useClubSession } from "./board/useClubSession.ts";
import { JudgeSim } from "./JudgeSim.tsx";
import { PersonaGraph } from "./PersonaGraph.tsx";

export function ClubLab({
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
  const { view, selectedId, setSelectedId, pending, mutate, run } = session;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <BoardHeader
        variant={variant}
        surface="lab"
        view={view}
        dirty={session.dirty}
        onReset={run.reset ? session.resetToSeed : undefined}
      />
      {session.error ? (
        <BoardError
          error={session.error}
          onDismiss={() => session.setError(null)}
          onReset={run.reset ? session.resetToSeed : undefined}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:gap-4 sm:p-4 xl:grid-cols-12">
        <section className="rounded-lg border border-line bg-panel p-3 sm:col-span-2 xl:col-span-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Referral network</h2>
            <label className="text-[11px] text-muted">
              <input
                type="checkbox"
                className="mr-1 accent-ink"
                checked={session.personasOnly}
                onChange={(e) => session.setPersonasOnly(e.target.checked)}
              />
              personas
            </label>
          </div>
          <PersonaGraph
            nodes={view.graph.nodes}
            edges={view.graph.edges}
            selectedId={selectedId}
            personasOnly={session.personasOnly}
            onSelect={setSelectedId}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Circle size follows {PRODUCT_LANGUAGE.referralSignal} (V2) when there is incoming
            evidence. A dashed circle is {PRODUCT_LANGUAGE.insufficientEvidence} — missing evidence,
            not a score of 0. Solid edges contributed to the signal; dashed edges are real referrals
            that did not.
            {variant === "example" ? " Cleo is quiet; Bram is loud." : ""}
            {variant === "example" && !session.personasOnly
              ? " Personas stay on the inner ring; other people sit outside so the graph stays readable."
              : ""}
          </p>
        </section>

        <section className="rounded-lg border border-line bg-panel p-4 sm:col-span-1 xl:col-span-4">
          <ComparePanel
            view={view}
            busy={pending}
            onCompare={(outcome) => {
              const next = view.nextCompare;
              if (!next) return;
              mutate((latest) =>
                run.addComparison(latest, {
                  personAId: next.personAId,
                  personBId: next.personBId,
                  dimension: next.dimension,
                  outcome,
                }),
              );
            }}
          />
        </section>

        <section className="rounded-lg border border-line bg-panel p-4 sm:col-span-1 xl:col-span-4">
          <JudgeSim
            view={view}
            busy={pending}
            onPickTime={(now) => mutate((latest) => run.setNow(latest, now))}
            onSelectJudge={setSelectedId}
          />
        </section>
      </div>
    </div>
  );
}
