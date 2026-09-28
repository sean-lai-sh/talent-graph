"use client";

import { useEffect, useRef, useState } from "react";
import type { Dimension } from "../../../../src/domain/types.ts";
import type {
  LadderPlacement,
  LadderStepView,
  LadderTraitView,
} from "../../lib/ladderPlacement.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";

type OpenLadder = Extract<LadderStepView, { skipped: false }>;

const COUNT_WORD = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE"] as const;

function defaultOrder(trait: LadderTraitView, applicantId: string): string[] {
  return [...trait.anchors.map((anchor) => anchor.id), applicantId];
}

function placeAt(order: readonly string[], applicantId: string, toIndex: number): string[] {
  const from = order.indexOf(applicantId);
  if (from < 0 || from === toIndex) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(toIndex, 0, applicantId);
  return next;
}

function moveBy(order: readonly string[], applicantId: string, delta: number): string[] {
  const from = order.indexOf(applicantId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return [...order];
  return placeAt(order, applicantId, to);
}

export function LadderStep({
  view,
  busy,
  error,
  onBack,
  onPlace,
  onFinished,
}: {
  view: OpenLadder;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onPlace: (dimension: Dimension, placement: LadderPlacement) => Promise<string | null>;
  onFinished: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [placed, setPlaced] = useState<ReadonlySet<Dimension>>(new Set());
  const [orders, setOrders] = useState<Partial<Record<Dimension, string[]>>>({});
  const [cantHover, setCantHover] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const dragging = useRef(false);
  const dragOrigin = useRef<{
    order: string[];
    slots: { top: number; bottom: number; index: number }[];
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLButtonElement>(null);
  const trait = view.traits[index];
  const name = view.applicantName;

  useEffect(() => {
    if (index >= 0) listRef.current?.focus();
  }, [index]);

  if (!trait) return null;

  const readOnly = placed.has(trait.dimension);
  const order = orders[trait.dimension] ?? defaultOrder(trait, view.applicantId);
  const nextTrait = view.traits[index + 1];
  const shownError = localError ?? error;

  function remember(next: string[]) {
    setOrders((current) => ({ ...current, [trait.dimension]: next }));
  }

  async function confirm(placement: LadderPlacement) {
    if (busy || readOnly) return;
    setLocalError(null);
    const failed = await onPlace(trait.dimension, placement);
    if (failed) {
      setLocalError(failed);
      return;
    }
    const nextPlaced = new Set(placed);
    nextPlaced.add(trait.dimension);
    setPlaced(nextPlaced);
    if (!nextTrait) onFinished();
    else setIndex(index + 1);
  }

  function skip() {
    if (busy) return;
    setLocalError(null);
    if (!nextTrait) onFinished();
    else setIndex(index + 1);
  }

  function back() {
    setLocalError(null);
    if (index === 0) onBack();
    else setIndex(index - 1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (readOnly || busy) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      remember(moveBy(order, view.applicantId, -1));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      remember(moveBy(order, view.applicantId, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void confirm({ kind: "order", order });
    }
  }

  function overZone(event: { clientX: number; clientY: number }): boolean {
    const rect = zoneRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const origin = dragOrigin.current;
    if (!dragging.current || !origin || readOnly) return;
    if (overZone(event)) {
      setCantHover(true);
      return;
    }
    setCantHover(false);
    const hit = origin.slots.find(
      (slot) => event.clientY >= slot.top && event.clientY < slot.bottom,
    );
    if (!hit || !Number.isInteger(hit.index)) return;
    remember(placeAt(origin.order, view.applicantId, hit.index));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    dragOrigin.current = null;
    setCantHover(false);
    if (overZone(event)) void confirm({ kind: "cant_place" });
  }

  const countWord = COUNT_WORD[trait.anchors.length] ?? String(trait.anchors.length);

  return (
    <div className="flex min-h-full flex-col px-6 py-6">
      <p className="text-xs tracking-wide text-muted">
        {`STEP 4 OF 4 - PLACE ${name.toUpperCase()}`}
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        {`Where does ${name} fit among people you know?`}
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-secondary">
        {`Drag ${name} into your list. The list is people in the club you've marked as known: members, and people you referred. One trait at a time.`}
      </p>

      <fieldset className="mt-4 flex flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">Traits</legend>
        {view.traits.map((item, traitIndex) => {
          const current = traitIndex === index;
          const done = placed.has(item.dimension);
          return (
            <span
              key={item.dimension}
              aria-current={current ? "step" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                current ? "border-ink bg-ink text-canvas" : "border-line bg-raised text-secondary"
              }`}
            >
              {done ? (
                <span aria-hidden="true" className="text-success">
                  ✓
                </span>
              ) : null}
              {item.label}
              {done ? <span className="sr-only"> done</span> : null}
            </span>
          );
        })}
      </fieldset>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.85fr)]">
        <section className="rounded-xl border border-line bg-surface p-4 shadow-[var(--e2)]">
          <h3 className="text-base font-medium text-ink">{trait.prompt}</h3>
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>{`Stronger on ${trait.label.toLowerCase()}`}</span>
            <span>drag to reorder</span>
          </div>
          <div
            ref={listRef}
            role="listbox"
            tabIndex={0}
            aria-label={`Placement list for ${name}. Arrow keys move ${name}. Enter confirms.`}
            className="mt-3 space-y-2 outline-none focus-visible:shadow-[var(--focus-ring)]"
            onKeyDown={onKeyDown}
          >
            {order.map((id, rowIndex) => {
              const applicant = id === view.applicantId;
              const anchor = trait.anchors.find((item) => item.id === id);
              const rowName = applicant ? name : (anchor?.name ?? "Unknown");
              const detail = applicant ? "Applicant you're referring" : (anchor?.relation ?? "");
              return (
                <div
                  key={id}
                  role="option"
                  aria-selected={applicant}
                  tabIndex={-1}
                  data-slot="row"
                  data-index={rowIndex}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    applicant
                      ? "cursor-grab touch-none border-accent bg-accent-tint text-ink"
                      : "border-line bg-canvas text-ink"
                  }`}
                  onPointerDown={
                    applicant
                      ? (event) => {
                          if (readOnly || busy || event.button !== 0) return;
                          const rows =
                            listRef.current?.querySelectorAll<HTMLElement>("[data-slot='row']") ??
                            [];
                          dragOrigin.current = {
                            order: [...order],
                            slots: [...rows].map((row) => {
                              const rect = row.getBoundingClientRect();
                              return {
                                top: rect.top,
                                bottom: rect.bottom,
                                index: Number(row.getAttribute("data-index")),
                              };
                            }),
                          };
                          dragging.current = true;
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }
                      : undefined
                  }
                  onPointerMove={applicant ? onPointerMove : undefined}
                  onPointerUp={applicant ? onPointerUp : undefined}
                >
                  <span className="w-4 text-xs text-muted tabular-nums">{rowIndex + 1}</span>
                  <Avatar name={rowName} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{rowName}</span>
                    <span className="block text-xs text-muted">{detail}</span>
                  </span>
                  {applicant ? (
                    <span
                      className="ml-auto rounded-md px-2 py-1 text-xs text-muted"
                      aria-hidden="true"
                    >
                      ::
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            ref={zoneRef}
            data-slot="cant-place"
            disabled={busy || readOnly}
            onClick={() => void confirm({ kind: "cant_place" })}
            className={`mt-3 w-full rounded-lg border border-dashed px-3 py-4 text-sm text-muted ${
              cantHover ? "border-warn bg-warn-tint text-warn" : "border-line-strong"
            }`}
          >
            {`Can't place ${name} on this trait? Drop here`}
          </button>
        </section>

        <div className="space-y-4">
          <section
            aria-label="What this placement records"
            className="rounded-xl border border-line bg-surface p-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs tracking-wide text-muted">WHAT THIS PLACEMENT RECORDS</h3>
              <p className="text-xs text-muted">{`${trait.anchors.length} comparisons`}</p>
            </div>
            <ul className="mt-3 space-y-2" aria-live="polite">
              {trait.anchors.map((anchor) => {
                const applicantAt = order.indexOf(view.applicantId);
                const anchorAt = order.indexOf(anchor.id);
                const applicantStronger = applicantAt !== -1 && applicantAt < anchorAt;
                const who = applicantStronger ? name : anchor.name;
                return (
                  <li key={anchor.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-secondary">{`${name} vs ${anchor.name}`}</span>
                    <span className={applicantStronger ? "text-success" : "text-danger"}>
                      {`${who} stronger`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section
            aria-label={`Why these ${countWord.toLowerCase()}`}
            className="rounded-xl border border-line bg-surface p-4"
          >
            <h3 className="text-xs tracking-wide text-muted">{`WHY THESE ${countWord}`}</h3>
            <p className="mt-2 text-sm text-secondary">
              {`They already have comparisons on ${trait.label}, so they act as anchors: ${name}'s placement ties into the club-wide ranking instead of floating on its own.`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {trait.estimatedCount > 0 ? (
                <Badge>
                  {`${trait.estimatedCount} ${trait.estimatedCount === 1 ? "ANCHOR" : "ANCHORS"} ESTIMATED`}
                </Badge>
              ) : null}
              {trait.thinCount > 0 ? (
                <Badge tone="warn">{`${trait.thinCount} STILL THIN`}</Badge>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      {readOnly ? <p className="mt-4 text-xs text-muted">This trait is already placed.</p> : null}
      {shownError ? (
        <p role="alert" className="mt-4 text-xs text-danger">
          {shownError}
        </p>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" disabled={busy} onClick={back}>
          Back
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={skip}>
            Skip this trait
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => {
              if (readOnly) {
                if (!nextTrait) onFinished();
                else setIndex(index + 1);
                return;
              }
              void confirm({ kind: "order", order });
            }}
          >
            {nextTrait ? `Next trait: ${nextTrait.label}` : "Finish"}
          </Button>
        </div>
      </div>
    </div>
  );
}
