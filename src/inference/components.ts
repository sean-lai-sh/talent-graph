/**
 * Connected components of the comparison graph, per dimension.
 *
 * Bradley–Terry is translation-invariant only within a connected component:
 * two groups that have never been compared against each other have no
 * shared scale, so they are fitted and ranked separately.
 *
 * Iterative union-find; no recursion so large graphs are safe.
 */

import type { Comparison, Dimension } from "../domain/types.ts";

export interface ComponentInfo {
  /** `${label}:${smallest member id}` — deterministic across runs. */
  componentId: string;
  /** Sorted member ids. */
  members: string[];
  /** Edges (observations) inside the component. */
  comparisonCount: number;
}

export interface ComponentResult {
  byPerson: Map<string, string>;
  components: ComponentInfo[];
}

class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly rank = new Map<string, number>();

  add(id: string): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    // path compression
    let cur = id;
    while (cur !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }
}

/**
 * Generic components over undirected edges. People with no edges form
 * singleton components. Edges touching ids outside `personIds` are ignored.
 */
export function connectedComponents(
  personIds: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>,
  label: string,
): ComponentResult {
  const uf = new UnionFind();
  const known = new Set(personIds);
  for (const id of personIds) uf.add(id);

  const edgeCount = new Map<string, number>();
  for (const [a, b] of edges) {
    if (!known.has(a) || !known.has(b) || a === b) continue;
    uf.union(a, b);
  }
  for (const [a, b] of edges) {
    if (!known.has(a) || !known.has(b) || a === b) continue;
    const root = uf.find(a);
    edgeCount.set(root, (edgeCount.get(root) ?? 0) + 1);
  }

  const membersByRoot = new Map<string, string[]>();
  for (const id of personIds) {
    const root = uf.find(id);
    const list = membersByRoot.get(root);
    if (list) list.push(id);
    else membersByRoot.set(root, [id]);
  }

  const components: ComponentInfo[] = [];
  const byPerson = new Map<string, string>();
  for (const [root, members] of membersByRoot) {
    members.sort();
    const componentId = `${label}:${members[0]}`;
    components.push({ componentId, members, comparisonCount: edgeCount.get(root) ?? 0 });
    for (const m of members) byPerson.set(m, componentId);
  }
  components.sort((x, y) => (x.componentId < y.componentId ? -1 : 1));
  return { byPerson, components };
}

export interface ComparisonComponentOptions {
  /** Count `tie` outcomes as edges (they are observations when tieHandling is "half"). */
  includeTies?: boolean;
}

/**
 * Components on one dimension. An edge exists iff two people share at least
 * one comparison on that dimension with outcome "a" or "b" (or "tie" when
 * `includeTies`). `skip` and `insufficient_observation` never create edges.
 */
export function comparisonComponents(
  personIds: readonly string[],
  comparisons: readonly Comparison[],
  dimension: Dimension,
  opts: ComparisonComponentOptions = {},
): ComponentResult {
  const edges: Array<readonly [string, string]> = [];
  for (const c of comparisons) {
    if (c.dimension !== dimension) continue;
    const informative =
      c.outcome === "a" || c.outcome === "b" || (opts.includeTies === true && c.outcome === "tie");
    if (!informative) continue;
    edges.push([c.personAId, c.personBId]);
  }
  return connectedComponents(personIds, edges, dimension);
}
