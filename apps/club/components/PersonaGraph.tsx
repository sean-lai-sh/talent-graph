"use client";

import { layoutGraph, nodeRadius, selectGraphNodes } from "../lib/graphLayout.ts";
import type { GraphEdge, GraphNode } from "../lib/types.ts";

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function edgeStroke(e: GraphEdge): { width: number; opacity: number } {
  return {
    width: 0.8 + e.strength * 2,
    opacity: e.contributing ? 0.3 + e.strength * 0.55 : 0.16 + e.strength * 0.35,
  };
}

export function PersonaGraph({
  nodes,
  edges,
  selectedId,
  personasOnly,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  personasOnly: boolean;
  onSelect: (id: string) => void;
}) {
  const shown = selectGraphNodes(nodes, personasOnly);
  const ids = new Set(shown.map((n) => n.id));
  const pos = layoutGraph(shown);
  const drawn = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const others = shown.filter((n) => !n.persona).length;

  if (shown.length === 0) {
    return <p className="text-sm text-muted">No one to show on this graph.</p>;
  }

  return (
    <svg
      viewBox="0 0 360 320"
      className="board-graph h-auto w-full max-h-[42vh] xl:max-h-none"
      role="img"
      aria-label="Referral network"
    >
      {drawn.map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2 - 12;
        const stroke = edgeStroke(e);
        return (
          <path
            key={`${e.from}-${e.to}`}
            d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
            fill="none"
            stroke="#c4b8a8"
            strokeWidth={stroke.width}
            strokeDasharray={e.contributing ? undefined : "3 3"}
            opacity={stroke.opacity}
          />
        );
      })}
      {shown.map((n) => {
        const p = pos.get(n.id);
        if (!p) return null;
        const selected = n.id === selectedId;
        const quiet = n.v2Signal !== null && n.v2Signal <= 15;
        const loud = n.v2Signal !== null && n.v2Signal >= 50;
        return (
          <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
            <a
              href={`#${n.id}`}
              className="cursor-pointer"
              aria-label={n.name}
              onClick={(ev) => {
                ev.preventDefault();
                onSelect(n.id);
              }}
            >
              <circle
                r={nodeRadius(n, selected)}
                fill={
                  n.status === "member"
                    ? "#1e3a5f"
                    : n.status === "archived"
                      ? "#a8a29e"
                      : "#fffdf8"
                }
                stroke={selected ? "#9a3412" : "#1c1915"}
                strokeWidth={selected ? 2.4 : 1.2}
                strokeDasharray={n.v2Signal === null ? "2 2" : undefined}
              />
              <text
                y={nodeRadius(n, selected) + 12}
                textAnchor="middle"
                className="fill-ink"
                style={{ fontSize: n.persona ? 9 : 8, fontFamily: "var(--font-geist-sans)" }}
              >
                {firstName(n.name)}
                {quiet ? " · quiet" : loud ? " · loud" : ""}
              </text>
            </a>
          </g>
        );
      })}
      {!personasOnly && others > 0 ? (
        <text
          x={180}
          y={312}
          textAnchor="middle"
          className="fill-muted"
          style={{ fontSize: 8, fontFamily: "var(--font-geist-sans)" }}
        >
          Personas inside · {others} other people on the outer ring
        </text>
      ) : null}
    </svg>
  );
}
