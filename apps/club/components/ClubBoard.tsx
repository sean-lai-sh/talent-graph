"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { REVIEW_BUCKET_ORDER } from "../../../src/analysis/reviewQueue.ts";
import { describeActionError } from "../lib/actionError.ts";
import { resolveBoardActions } from "../lib/clubActions.ts";
import { underConsideration } from "../lib/review.ts";
import type {
  AddPersonInput,
  CandidateRow,
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
import { CandidateList } from "./candidates/CandidateList.tsx";
import { CaseView } from "./case/CaseView.tsx";
import { ErrorBanner } from "./shell/ErrorBanner.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Kbd } from "./ui/Kbd.tsx";

function sortQueue(candidates: CandidateRow[]): CandidateRow[] {
  const urgency = (bucket: CandidateRow["bucket"]) => {
    if (!bucket) return REVIEW_BUCKET_ORDER.length;
    return REVIEW_BUCKET_ORDER.indexOf(bucket);
  };
  return candidates
    .filter((c) => underConsideration(c.reviewStatus))
    .slice()
    .sort((a, b) => {
      const aNull = a.v2Signal === null;
      const bNull = b.v2Signal === null;
      if (aNull !== bNull) return aNull ? 1 : -1;
      if (a.v2Signal !== null && b.v2Signal !== null && a.v2Signal !== b.v2Signal) {
        return b.v2Signal - a.v2Signal;
      }
      return (
        urgency(a.bucket) - urgency(b.bucket) ||
        b.daysInReview - a.daysInReview ||
        a.name.localeCompare(b.name)
      );
    });
}

function sortDecided(candidates: CandidateRow[]): CandidateRow[] {
  return candidates
    .filter((c) => !underConsideration(c.reviewStatus))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
}

function matchesQuery(row: CandidateRow, query: string): boolean {
  if (!query) return true;
  return row.name.toLowerCase().includes(query);
}

/**
 * Admin / Council Review page. Master-detail: candidate list on the left,
 * one case on the right. Present mode hides the chrome for a screen share.
 * Every number on screen comes from `lib/engine.ts` → `src/`; this file
 * holds selection, search, and the mutation chain only.
 */
export function ClubBoard({
  initial,
  variant = "example",
  actions,
  sync,
  clock = "example",
  role = "council",
  onSignOut,
}: {
  initial: EngineResult;
  variant?: "example" | "club";
  actions?: Partial<ClubBoardActions>;
  sync?: EngineResult | null;
  /** "example": feedback windows tick against the seed clock. "wall": against real time. */
  clock?: "example" | "wall";
  role?: "council";
  onSignOut?: () => void;
}) {
  const run: ClubBoardActions = resolveBoardActions(variant, actions);
  const firstId = sortQueue(initial.view.candidates)[0]?.personId ?? null;
  const [state, setState] = useState<ClubState>(initial.state);
  const [view, setView] = useState<ClubView>(initial.view);
  const [error, setError] = useState<string | null>(initial.error ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(firstId);
  const [present, setPresent] = useState(false);
  const [pane, setPane] = useState<"list" | "case">(variant === "club" ? "list" : "case");
  const [query, setQuery] = useState("");
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
        setSelectedId(sortQueue(result.view.candidates)[0]?.personId ?? null);
        setQuery("");
        return result;
      },
      { seed: true },
    );
  };

  const q = query.trim().toLowerCase();
  const queue = useMemo(
    () => sortQueue(view.candidates).filter((row) => matchesQuery(row, q)),
    [view.candidates, q],
  );
  const decided = useMemo(
    () => sortDecided(view.candidates).filter((row) => matchesQuery(row, q)),
    [view.candidates, q],
  );
  const visible = useMemo(() => [...queue, ...decided], [queue, decided]);

  const selected: PersonView | undefined = useMemo(
    () =>
      view.people.find((p) => p.id === selectedId) ??
      view.people.find((p) => p.id === visible[0]?.personId),
    [view.people, selectedId, visible],
  );

  const select = (id: string) => {
    setSelectedId(id);
    setPane("case");
  };

  const selectedKey = selected?.id ?? null;
  const step = useCallback(
    (dir: number) => {
      if (visible.length === 0) return;
      const idx = visible.findIndex((r) => r.personId === selectedKey);
      const next = visible[Math.min(visible.length - 1, Math.max(0, (idx === -1 ? 0 : idx) + dir))];
      if (next) {
        setSelectedId(next.personId);
        setPane("case");
      }
    },
    [visible, selectedKey],
  );

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
      const dir =
        e.key === "j" || e.key === "ArrowDown" || e.key === "ArrowRight"
          ? 1
          : e.key === "k" || e.key === "ArrowUp" || e.key === "ArrowLeft"
            ? -1
            : 0;
      if (dir === 0) return;
      e.preventDefault();
      step(dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const clockIso = clock === "wall" ? new Date().toISOString() : view.now;
  const canDecide = role === "council";
  const at = visible.findIndex((r) => r.personId === selected?.id);
  const counter = at >= 0 ? `${at + 1} of ${visible.length}` : `${visible.length} shown`;

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
        }
      }
      return result;
    });
  };

  return (
    <div
      data-present={present ? "" : undefined}
      className={`app-shell bg-canvas text-ink ${present ? "is-present" : ""}`}
    >
      {!present ? (
        <TopBar
          config={view.config}
          dirty={dirty}
          busy={pending}
          canAdd={run.addPerson !== undefined}
          canReset={run.reset !== undefined}
          counter={counter}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onOpenList={() => setPane("list")}
          onAddPerson={onAddPerson}
          onReset={resetToSeed}
          onConfig={onConfig}
          onSignOut={onSignOut}
        />
      ) : (
        <div className="app-toolbar text-xs text-muted">
          <span>
            Present mode · <Kbd>J</Kbd> <Kbd>K</Kbd> next / previous case · <Kbd>Esc</Kbd> exit
          </span>
          <div className="flex-1" />
          <span className="counter">{counter}</span>
        </div>
      )}

      {!present ? (
        <aside
          aria-label="Applicants"
          className={`app-panel ${pane === "case" ? "hidden lg:flex" : "flex"}`}
        >
          <CandidateList
            queue={queue}
            decided={decided}
            directory={view.candidates}
            query={query}
            selectedId={selected?.id ?? null}
            onQuery={setQuery}
            onSelect={select}
          />
        </aside>
      ) : null}

      <main className={`app-main ${pane === "list" && !present ? "hidden lg:block" : ""}`}>
        {error ? (
          <ErrorBanner
            error={error}
            onDismiss={() => setError(null)}
            {...(run.reset ? { onReset: resetToSeed } : {})}
          />
        ) : null}
        {selected ? (
          <CaseView
            key={selected.id}
            person={selected}
            people={view.people}
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
  );
}
