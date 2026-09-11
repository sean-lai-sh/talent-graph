"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import type { GraphEdge, GraphNode } from "../lib/types.ts";
import { PersonaGraph } from "./PersonaGraph.tsx";

export type GraphMode = "open" | "min";

const WIDE = "(min-width: 1024px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Default: open on wide screens, minimized on phones. Server renders minimized. */
export function useDefaultGraphMode(): GraphMode {
  return useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(WIDE).matches ? "open" : "min"),
    () => "min",
  );
}

/**
 * The referral network as a floating, minimizable panel anchored to the
 * viewport. It never takes a grid column, so the board fits next to an app or
 * browser sidebar. Minimized it is a single pill in the bottom-right corner.
 */
export function GraphPanel({
  mode,
  onMode,
  nodes,
  edges,
  selectedId,
  personasOnly,
  onPersonasOnly,
  onSelect,
  caption,
}: {
  mode: GraphMode;
  onMode: (mode: GraphMode) => void;
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string;
  personasOnly: boolean;
  onPersonasOnly: (v: boolean) => void;
  onSelect: (id: string) => void;
  caption: ReactNode;
}) {
  if (mode === "min") {
    return (
      <button
        type="button"
        onClick={() => onMode("open")}
        className="fixed bottom-3 right-3 z-20 flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-xs shadow-md hover:bg-paper"
        aria-label="Show referral network"
      >
        <span aria-hidden className="inline-block h-2 w-2 rounded-full border border-ink" />
        Referral network
        <span aria-hidden className="text-muted">
          ▴
        </span>
      </button>
    );
  }

  return (
    <aside
      aria-label="Referral network"
      className="board-graph-panel fixed inset-x-3 bottom-3 z-20 flex max-h-[min(70vh,560px)] flex-col rounded-lg border border-line bg-panel shadow-xl sm:inset-x-auto sm:right-3 sm:w-[360px]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-medium">Referral network</h2>
        <div className="flex items-center gap-3">
          <label className="text-[11px] text-muted">
            <input
              type="checkbox"
              className="mr-1 accent-ink"
              checked={personasOnly}
              onChange={(e) => onPersonasOnly(e.target.checked)}
            />
            personas
          </label>
          <button
            type="button"
            onClick={() => onMode("min")}
            className="rounded px-1.5 text-sm leading-none text-muted hover:bg-paper hover:text-ink"
            aria-label="Minimize referral network"
            title="Minimize"
          >
            ▾
          </button>
        </div>
      </div>
      <div className="board-scroll min-h-0 overflow-y-auto px-3 pb-3 pt-2">
        <PersonaGraph
          nodes={nodes}
          edges={edges}
          selectedId={selectedId}
          personasOnly={personasOnly}
          onSelect={onSelect}
        />
        <p className="mt-2 text-[10px] leading-relaxed text-muted">{caption}</p>
      </div>
    </aside>
  );
}
