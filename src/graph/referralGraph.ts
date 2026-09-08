/**
 * Pure helpers over the directed referral graph u → v.
 *
 * Structural questions only (who refers whom, degrees, neighbourhoods,
 * filters). No layout, no positions, and nothing from Bradley–Terry.
 * `graph → scoring` is an allowed dependency (for edge weights);
 * `scoring → graph` is not.
 */

import type { EvidenceType, Person, PersonStatus, Referral } from "../domain/types.ts";
import { CURRENT_SPECS } from "../models/registry.ts";
import type { ReferralSignalSpec } from "../models/spec.ts";
import type { ReferralSignalResult } from "../scoring/referralSignal.ts";
import { referralStrength } from "../scoring/referralStrength.ts";

export interface ReferralGraph {
  nodes: Map<string, Person>;
  /** Referrals made by a person id. */
  out: Map<string, Referral[]>;
  /** Referrals received by a person id. */
  in: Map<string, Referral[]>;
}

/**
 * Build adjacency from raw records. Referrals whose endpoints are not in
 * `people` are dropped so every edge is between known nodes.
 */
export function buildReferralGraph(
  people: readonly Person[],
  referrals: readonly Referral[],
): ReferralGraph {
  const nodes = new Map<string, Person>();
  const out = new Map<string, Referral[]>();
  const incoming = new Map<string, Referral[]>();
  for (const p of people) {
    nodes.set(p.id, p);
    out.set(p.id, []);
    incoming.set(p.id, []);
  }
  for (const r of referrals) {
    const from = out.get(r.referrerId);
    const to = incoming.get(r.candidateId);
    if (!from || !to) continue;
    from.push(r);
    to.push(r);
  }
  return { nodes, out, in: incoming };
}

function peopleFrom(g: ReferralGraph, ids: Iterable<string>): Person[] {
  const seen = new Set<string>();
  const result: Person[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = g.nodes.get(id);
    if (p) result.push(p);
  }
  return result;
}

/** People who referred `personId`. */
export function referrersOf(g: ReferralGraph, personId: string): Person[] {
  return peopleFrom(
    g,
    (g.in.get(personId) ?? []).map((r) => r.referrerId),
  );
}

/** People whom `personId` referred. */
export function referredBy(g: ReferralGraph, personId: string): Person[] {
  return peopleFrom(
    g,
    (g.out.get(personId) ?? []).map((r) => r.candidateId),
  );
}

export function inDegree(g: ReferralGraph, personId: string): number {
  return g.in.get(personId)?.length ?? 0;
}

export function outDegree(g: ReferralGraph, personId: string): number {
  return g.out.get(personId)?.length ?? 0;
}

/**
 * Everyone within `depth` undirected hops of `personId` (including the
 * person), plus every referral among that set. Iterative BFS.
 */
export function neighbourhood(
  g: ReferralGraph,
  personId: string,
  depth = 1,
): { people: Person[]; referrals: Referral[] } {
  if (!g.nodes.has(personId)) return { people: [], referrals: [] };

  const visited = new Set<string>([personId]);
  let frontier = [personId];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      const adjacent = [
        ...(g.out.get(id) ?? []).map((r) => r.candidateId),
        ...(g.in.get(id) ?? []).map((r) => r.referrerId),
      ];
      for (const other of adjacent) {
        if (!visited.has(other)) {
          visited.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }

  const people = peopleFrom(g, visited);
  const referrals: Referral[] = [];
  const seenEdges = new Set<string>();
  for (const id of visited) {
    for (const r of g.out.get(id) ?? []) {
      if (visited.has(r.candidateId) && !seenEdges.has(r.id)) {
        seenEdges.add(r.id);
        referrals.push(r);
      }
    }
  }
  return { people, referrals };
}

export interface GraphFilter {
  status?: PersonStatus[];
  /** Exact match on the display-only affiliation string. Filtering, not scoring. */
  affiliation?: string;
  /** Keep only referrals of these evidence types. */
  evidenceTypes?: EvidenceType[];
  /** Keep only people whose Referral Signal ≥ this; requires `signals`. */
  minSignal?: number;
  signals?: Map<string, ReferralSignalResult>;
}

/**
 * Sub-graph induced by people matching the person filters, keeping only
 * referrals matching the referral filters. Signals are passed in, never
 * computed here.
 */
export function filterGraph(g: ReferralGraph, f: GraphFilter): ReferralGraph {
  if (f.minSignal !== undefined && f.signals === undefined) {
    throw new Error("filterGraph: minSignal requires signals to be passed in");
  }

  const people = [...g.nodes.values()].filter((p) => {
    if (f.status && !f.status.includes(p.status)) return false;
    if (f.affiliation !== undefined && p.affiliation !== f.affiliation) return false;
    if (f.minSignal !== undefined) {
      const s = f.signals?.get(p.id);
      if (s === undefined || s.signal < f.minSignal) return false;
    }
    return true;
  });

  const referrals: Referral[] = [];
  const seen = new Set<string>();
  for (const list of g.out.values()) {
    for (const r of list) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (f.evidenceTypes && !f.evidenceTypes.includes(r.evidenceType)) continue;
      referrals.push(r);
    }
  }

  return buildReferralGraph(people, referrals);
}

/**
 * Directed edge list with R_uv as weight, for export or a future renderer.
 * Pass the spec a historical run used to reproduce its weights exactly;
 * the default is the current spec.
 */
export function toEdgeList(
  g: ReferralGraph,
  spec: ReferralSignalSpec = CURRENT_SPECS.referral_signal,
): Array<{ source: string; target: string; weight: number }> {
  const edges: Array<{ source: string; target: string; weight: number }> = [];
  for (const list of g.out.values()) {
    for (const r of list) {
      edges.push({
        source: r.referrerId,
        target: r.candidateId,
        weight: referralStrength(r, spec),
      });
    }
  }
  return edges;
}
