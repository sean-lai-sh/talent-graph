"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { describeActionError } from "../lib/actionError.ts";
import { resolveBoardActions } from "../lib/clubActions.ts";
import { rankAmong } from "../lib/format.ts";
import { type SortDir, sortRows } from "../lib/tableModel.ts";
import type {
  AddPersonInput,
  ClubBoardActions,
  ClubState,
  ClubView,
  Decision,
  EngineResult,
  PersonView,
  RecordFeedbackInput,
  RequestFeedbackInput,
  SetReviewConfigInput,
} from "../lib/types.ts";
import {
  CandidateList,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  type ListFilters,
  type SortKey,
} from "./candidates/CandidateList.tsx";
import { CaseView } from "./case/CaseView.tsx";
import { ErrorBanner } from "./shell/ErrorBanner.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Kbd } from "./ui/Kbd.tsx";

/**
 * Admin / Council Review page. Master-detail: candidate list on the left,
 * one case on the right. Present mode hides the chrome for a screen share.
 * Every number on screen comes from `lib/engine.ts` → `src/`; this file
 * holds selection, filters, and the mutation chain only.
 */
export function ClubBoard({
  initial,
  variant = "example",
  actions,
  sync,
  clock = "example",
  role = "council",
}: {
  initial: EngineResult;
  variant?: "example" | "club";
  actions?: Partial<ClubBoardActions>;
  sync?: EngineResult | null;
  /** "example": feedback windows tick against the seed clock. "wall": against real time. */
  clock?: "example" | "wall";
  role?: "council";
}) {
  const run: ClubBoardActions = resolveBoardActions(variant, actions);
  const firstId =
    initial.view.people.find((p) => p.id === "p-cleo")?.id ??
    initial.view.candidates[0]?.personId ??
    null;
  const [state, setState] = useState<ClubState>(initial.state);
  const [view, setView] = useState<ClubView>(initial.view);
  const [error, setError] = useState<string | null>(initial.error ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(firstId);
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(DEFAULT_SORT);
  const [present, setPresent] = useState(false);
  const [pane, setPane] = useState<"list" | "case">(variant === "club" ? "list" : "case");
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const stateRef = useRef(state);
  const chainRef = useRef(Promise.resolve());

  const apply = (result: EngineResult) => {
    setState(result.state);
    setView(result.view);
    setError(result.error ?? null);
    stateRef.current = result.state;
  };

  // Convex pushes a new board through `sync`; adopt it during render (no effect, no flash).
  const [seenSync, setSeenSync] = useState(sync);
  if (sync && sync !== seenSync) {
    setSeenSync(sync);
    setState(sync.state);
    setView(sync.view);
    setError(sync.error ?? null);
  }
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
        setFilters(DEFAULT_FILTERS);
        setSort(DEFAULT_SORT);
        return result;
      },
      { seed: true },
    );
  };

  const rows = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    const filtered = view.candidates.filter((c) => {
      if (!filters.statuses.includes(c.reviewStatus)) return false;
      if (filters.bucket !== "all" && c.bucket !== filters.bucket) return false;
      if (filters.overdueOnly && c.overdueFeedback === 0) return false;
      if (q && !`${c.name} ${c.affiliation}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const key = (c: (typeof filtered)[number]) => {
      switch (sort.key) {
        case "name":
          return c.name;
        case "status":
          return c.reviewStatus;
        case "signal":
          return c.v2Signal;
        case "incoming":
          return c.incomingCount;
        case "dimension": {
          const est = c.estimated[filters.dimension];
          return est ? rankAmong(est.percentile, est.poolSize) : null;
        }
        case "rubric":
          return c.evaluationCount;
        case "days":
          return c.daysInReview;
        case "created":
          return c.createdAt;
      }
    };
    return sortRows(filtered, key, sort.dir);
  }, [view.candidates, filters, sort]);

  const selected: PersonView | undefined = useMemo(
    () =>
      view.people.find((p) => p.id === selectedId) ??
      view.people.find((p) => p.id === rows[0]?.personId),
    [view.people, selectedId, rows],
  );

  const select = (id: string) => {
    setSelectedId(id);
    setPane("case");
  };

  // J / K and arrows move through the filtered list; Esc leaves present mode. Never animated.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        setPresent(false);
        return;
      }
      const step =
        e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
      if (step === 0 || rows.length === 0) return;
      e.preventDefault();
      const idx = rows.findIndex((r) => r.personId === selected?.id);
      const next = rows[Math.min(rows.length - 1, Math.max(0, (idx === -1 ? 0 : idx) + step))];
      if (next) setSelectedId(next.personId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selected?.id]);

  const clockIso = clock === "wall" ? new Date().toISOString() : view.now;
  const canDecide = role === "council";

  const onDecide = (decision: Decision) => {
    if (!selected) return;
    mutate((latest) => run.decide(latest, selected.id, decision));
  };
  const onRequestFeedback = (input: RequestFeedbackInput) =>
    mutate((latest) => run.requestFeedback(latest, input));
  const onRecordFeedback = (input: RecordFeedbackInput) =>
    mutate((latest) => run.recordFeedback(latest, input));
  const onConfig = (input: SetReviewConfigInput) =>
    mutate((latest) => run.setReviewConfig(latest, input));
  const onAddPerson = (input: AddPersonInput) => {
    if (!run.addPerson) return;
    mutate(async (latest) => {
      const result = await run.addPerson?.(latest, input);
      if (!result) return { state: latest, view };
      if (!result.error) {
        const created = result.state.people.find(
          (p) => !latest.people.some((row) => row.id === p.id),
        );
        if (created) {
          setSelectedId(created.id);
          setPane("case");
          setFilters((f) =>
            f.statuses.includes("new") ? f : { ...f, statuses: [...f.statuses, "new"] },
          );
        }
      }
      return result;
    });
  };

  return (
    <div
      data-present={present ? "" : undefined}
      className="flex min-h-screen flex-col bg-canvas text-ink"
    >
      {!present ? (
        <TopBar
          view={view}
          variant={variant}
          dirty={dirty}
          busy={pending}
          canAdd={run.addPerson !== undefined}
          canReset={run.reset !== undefined}
          onAddPerson={onAddPerson}
          onReset={resetToSeed}
          onConfig={onConfig}
          onPresent={() => setPresent(true)}
        />
      ) : (
        <div className="flex h-10 items-center justify-between border-b border-line px-6 text-xs text-muted">
          <span>
            Present mode · <Kbd>J</Kbd> <Kbd>K</Kbd> next / previous case · <Kbd>Esc</Kbd> exit
          </span>
          <span>
            {rows.findIndex((r) => r.personId === selected?.id) + 1} of {rows.length}
          </span>
        </div>
      )}

      {error ? (
        <ErrorBanner
          error={error}
          onDismiss={() => setError(null)}
          {...(run.reset ? { onReset: resetToSeed } : {})}
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        {!present ? (
          <aside
            aria-label="Candidates"
            className={`w-full shrink-0 border-r border-line md:sticky md:top-12 md:block md:h-[calc(100vh-3rem)] md:w-[380px] ${
              pane === "case" ? "hidden" : ""
            }`}
          >
            <CandidateList
              rows={rows}
              total={view.candidates.length}
              filters={filters}
              sort={sort}
              selectedId={selected?.id ?? null}
              onFilters={setFilters}
              onSort={setSort}
              onSelect={select}
            />
          </aside>
        ) : null}
        <main className={`min-w-0 flex-1 ${pane === "list" && !present ? "hidden md:block" : ""}`}>
          {selected ? (
            <CaseView
              key={selected.id}
              person={selected}
              members={view.members}
              config={view.config}
              clock={clockIso}
              busy={pending}
              present={present}
              canDecide={canDecide}
              onDecide={onDecide}
              onRequestFeedback={onRequestFeedback}
              onRecordFeedback={onRecordFeedback}
              onBack={() => setPane("list")}
            />
          ) : (
            <div className="mx-auto max-w-md px-6 py-16">
              <EmptyState title="Nobody under consideration.">
                {variant === "club"
                  ? "Add a person; referrals arrive from the member referral page."
                  : "Reset to seed restores the example."}
              </EmptyState>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
