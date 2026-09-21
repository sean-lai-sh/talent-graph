/**
 * Pure helpers over the directed referral graph u → v.
 *
 * Structural questions only (who refers whom, who was referred by whom). No
 * layout, no positions, nothing from Bradley–Terry, and no scores: this module
 * is zero-dependency apart from `src/domain/` (owner decision D2, #56 T3).
 * `scoring → graph` is the allowed dependency direction; `graph → scoring` is
 * not. Edge weights live in `src/scoring/scoredGraph.ts` (`toEdgeList`) and
 * score-based sub-graph selection in `src/analysis/graphSelection.ts`
 * (`selectBySignal`).
 */

import type { Person, Referral } from "../domain/types.ts";

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
