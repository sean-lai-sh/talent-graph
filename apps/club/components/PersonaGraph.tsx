"use client";

import type { GraphEdge, GraphNode } from "../lib/types.ts";

const PERSONA_ORDER = ["p-alice", "p-bram", "p-cleo", "p-dev", "p-ember", "p-fox"];

function layout(ids: string[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const n = ids.length;
  const cx = 160;
  const cy = 130;
  const r = n <= 6 ? 88 : 100;
  ids.forEach((id, i) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    pos.set(id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  });
  return pos;
}

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function nodeRadius(n: GraphNode, selected: boolean): number {
  const signal = n.v2Signal ?? 0;
  const base = 7 + (signal / 100) * 13;
  return selected ? base + 2 : base;
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
  const shown = personasOnly
    ? PERSONA_ORDER.map((id) => nodes.find((n) => n.id === id)).filter(
        (n): n is GraphNode => n !== undefined,
      )
    : nodes.filter((n) => n.persona || n.status !== "archived").slice(0, 18);

  const ids = shown.map((n) => n.id);
  const idSet = new Set(ids);
  const pos = layout(ids);
  const drawn = edges.filter((e) => idSet.has(e.from) && idSet.has(e.to));

  if (shown.length === 0) {
    return <p className="text-sm text-muted">No one to show on this graph.</p>;
  }

  return (
    <svg viewBox="0 0 320 270" className="h-auto w-full" role="img" aria-label="Referral network">
      {drawn.map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2 - 12;
        return (
          <path
            key={`${e.from}-${e.to}`}
            d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
            fill="none"
            stroke="#c4b8a8"
            strokeWidth={0.8 + e.strength * 2}
            opacity={0.7}
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
              onClick={(e) => {
                e.preventDefault();
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
                style={{ fontSize: 9, fontFamily: "var(--font-geist-sans)" }}
              >
                {firstName(n.name)}
                {quiet ? " · quiet" : loud ? " · loud" : ""}
              </text>
            </a>
          </g>
        );
      })}
    </svg>
  );
}
