"use client";

import { PRODUCT_LANGUAGE, SCALE_LABELS } from "../../../../src/domain/constants.ts";
import type { ClubView } from "../../lib/types.ts";

export function ComparePanel({
  view,
  busy,
  onCompare,
}: {
  view: ClubView;
  busy: boolean;
  onCompare: (outcome: "a" | "b" | "tie" | "skip" | "insufficient_observation") => void;
}) {
  const next = view.nextCompare;
  return (
    <div className={busy ? "opacity-70" : ""}>
      <h2 className="text-sm font-medium">Next compare</h2>
      {next ? (
        <>
          <p className="mt-2 text-sm">{next.prompt}</p>
          <p className="mt-1 text-xs text-muted">
            {next.dimensionLabel} · heuristic priority {next.priority.toFixed(2)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded-full bg-capability px-4 py-1.5 text-sm text-white disabled:opacity-40"
              onClick={() => onCompare("a")}
            >
              {next.personAName}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-full bg-capability px-4 py-1.5 text-sm text-white disabled:opacity-40"
              onClick={() => onCompare("b")}
            >
              {next.personBName}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40"
              onClick={() => onCompare("tie")}
            >
              Tie
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40"
              onClick={() => onCompare("skip")}
            >
              Skip
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40"
              onClick={() => onCompare("insufficient_observation")}
            >
              {PRODUCT_LANGUAGE.notObserved}
              <span className="sr-only"> ({SCALE_LABELS.rubricNotObserved})</span>
            </button>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">No pair to propose.</p>
      )}
    </div>
  );
}
