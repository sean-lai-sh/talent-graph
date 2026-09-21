/**
 * Score-based sub-graph selection.
 *
 * Split out of `graph/referralGraph.ts`'s `filterGraph` in #56 T3 so the
 * structural graph module stays zero-dependency (owner decision D2). Anything
 * that needs a score to decide what stays in a graph lives here, above
 * `scoring/`, never inside `graph/`.
 *
 * Signals are always passed in, never computed here: this module has no
 * opinion about how a Referral Signal is produced, and the Referral Signal is
 * not a capability estimate.
 */

import type { Person, Referral } from "../domain/types.ts";
import { buildReferralGraph, type ReferralGraph } from "../graph/referralGraph.ts";
import type { ReferralSignalResult } from "../scoring/referralSignal.ts";

/**
 * Sub-graph induced by the people whose Referral Signal is at least
 * `minSignal`, keeping every referral between two of them.
 *
 * `signals` is a required parameter, so the old `filterGraph` runtime throw
 * ("minSignal requires signals") is gone — the type checker says it instead.
 *
 * A person with no entry in `signals` has no signal, which is not a signal of
 * 0: they are excluded rather than scored as the lowest possible. Node and
 * edge order follow the input graph.
 */
export function selectBySignal(
  g: ReferralGraph,
  signals: ReadonlyMap<string, ReferralSignalResult>,
  minSignal: number,
): ReferralGraph {
  const people: Person[] = [];
  for (const p of g.nodes.values()) {
    const s = signals.get(p.id);
    if (s === undefined) continue; // absence is absence, not a 0
    if (s.signal < minSignal) continue;
    people.push(p);
  }

  const referrals: Referral[] = [];
  const seen = new Set<string>();
  for (const list of g.out.values()) {
    for (const r of list) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      referrals.push(r);
    }
  }

  // buildReferralGraph drops any edge whose endpoints did not survive.
  return buildReferralGraph(people, referrals);
}
