import type { GraphNode } from "./types.ts";

export const PERSONA_ORDER = ["p-alice", "p-bram", "p-cleo", "p-dev", "p-ember", "p-fox"] as const;

/** Extra nodes when personas-off. Enough to read; not a 32-node hairball. */
export const OTHER_GRAPH_LIMIT = 8;

/**
 * Fixed radius for people with no incoming referrals.
 * Signal 0 (quiet) is 7; this mid-band size must not share that band.
 */
export const UNMEASURED_NODE_RADIUS = 11;

export function nodeRadius(n: Pick<GraphNode, "v2Signal">, selected: boolean): number {
  const base = n.v2Signal === null ? UNMEASURED_NODE_RADIUS : 7 + (n.v2Signal / 100) * 13;
  return selected ? base + 2 : base;
}

export function selectGraphNodes(nodes: GraphNode[], personasOnly: boolean): GraphNode[] {
  const personas = PERSONA_ORDER.map((id) => nodes.find((n) => n.id === id)).filter(
    (n): n is GraphNode => n !== undefined,
  );
  if (personasOnly) return personas;
  const others = nodes
    .filter((n) => !n.persona && n.status !== "archived")
    .sort((a, b) => {
      const as = a.v2Signal ?? -1;
      const bs = b.v2Signal ?? -1;
      return bs - as || a.name.localeCompare(b.name);
    })
    .slice(0, OTHER_GRAPH_LIMIT);
  return [...personas, ...others];
}

export function layoutGraph(shown: GraphNode[]): Map<string, { x: number; y: number }> {
  const personas = shown.filter((n) => n.persona);
  const others = shown.filter((n) => !n.persona);
  const pos = new Map<string, { x: number; y: number }>();
  const cx = 180;
  const cy = 155;
  placeRing(personas.length > 0 ? personas : shown, cx, cy, others.length > 0 ? 72 : 88, pos);
  if (personas.length > 0 && others.length > 0) {
    placeRing(others, cx, cy, 132, pos);
  }
  return pos;
}

function placeRing(
  nodes: GraphNode[],
  cx: number,
  cy: number,
  r: number,
  pos: Map<string, { x: number; y: number }>,
): void {
  const n = nodes.length;
  nodes.forEach((node, i) => {
    const a = (Math.PI * 2 * i) / Math.max(1, n) - Math.PI / 2;
    pos.set(node.id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  });
}
