/**
 * One scored index over the referral graph: every R_uv computed exactly once.
 *
 * Today each surface re-derives referral strength on its own (the scorer, the
 * edge list, the Club view). This module is the single place that pairs a
 * referral with its R_uv under one spec, so later callers can read a strength
 * instead of recomputing it. Nothing consumes it yet — adding it changes no
 * displayed number.
 *
 * Layering (owner decision D2): `scoring → graph` is the allowed direction, so
 * this module imports `buildReferralGraph`. `src/graph/referralGraph.ts` still
 * imports `src/scoring/` today; ESM resolves the resulting cycle fine (neither
 * module touches the other at module-evaluation time) and the direction is
 * cleaned up in a later ticket.
 *
 * Admission rules, mirroring V0 exactly (`referralSignal.ts`):
 *
 *   - **Self-referrals** (`referrerId === candidateId`) are scored and appear
 *     in `byReferralId`, but never in `in` or `out`. V0's incoming filter is
 *     `candidateId === personId && referrerId !== personId`, so a self-referral
 *     is not incoming evidence for anyone; counting it here would diverge.
 *   - **Dangling** referrals — an endpoint that is not in `people` — are scored
 *     (V0 scores them) and listed in `dangling`. Under the default policy
 *     `"score"` they also appear in `in`/`out`, keyed by the id they name, even
 *     when that id is not a node. Under `"drop"` they are scored and listed but
 *     kept out of `in`/`out`; that is opt-in and is a SPEC change, not a
 *     refactor, so no caller should pass it to reproduce a V0 number.
 *   - `graph` is always the closed adjacency from `buildReferralGraph`, which
 *     drops dangling edges regardless of policy.
 *
 * Ordering: `in` and `out` preserve the order of the input `referrals` array.
 * V0's tie-break for equal `(strength, createdAt, id)` falls through to input
 * order, so any re-ordering here would be a silent numeric change.
 *
 * Absence is absence: every person in `people` gets a key in `in` and `out`
 * mapping to an empty array when they have no edges. A person with no incoming
 * referrals has no entry with a 0 strength — there is no score to read at all.
 */

import type { Person, Referral } from "../domain/types.ts";
import type { ReferralGraph } from "../graph/referralGraph.ts";
import { buildReferralGraph } from "../graph/referralGraph.ts";
import { assertSpec, type ReferralSignalSpec } from "../models/spec.ts";
import { type ReferralStrengthBreakdown, referralStrengthBreakdown } from "./referralStrength.ts";

export interface ScoredEdge {
  referral: Referral;
  /** R_uv under `specVersion`. Computed exactly once per run. */
  strength: number;
  breakdown: ReferralStrengthBreakdown;
  /** True when an endpoint is not a node: scored (V0 rule) but absent from `graph`. */
  dangling: boolean;
}

/**
 * How a referral with an unknown endpoint is treated. "score" is V0 behaviour
 * and the default; "drop" is opt-in and would be a SPEC change, not a refactor.
 */
export type DanglingPolicy = "score" | "drop";

export interface ScoredReferralGraph {
  graph: ReferralGraph;
  /** Scored incoming edges per candidate id, input order. Includes dangling when policy = "score". */
  in: ReadonlyMap<string, readonly ScoredEdge[]>;
  out: ReadonlyMap<string, readonly ScoredEdge[]>;
  /** Every referral, scored once — self-referrals and dangling edges included, whatever the policy. */
  byReferralId: ReadonlyMap<string, ScoredEdge>;
  dangling: readonly ScoredEdge[];
  specVersion: string;
  policy: DanglingPolicy;
}

function append(map: Map<string, ScoredEdge[]>, key: string, edge: ScoredEdge): void {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}

/**
 * Score every referral once and index it by endpoint.
 *
 * `spec` is REQUIRED: this module never reaches for a current-spec default, so
 * a historical run reproduces its own numbers by passing its own spec.
 */
export function scoreReferralGraph(
  people: readonly Person[],
  referrals: readonly Referral[],
  spec: ReferralSignalSpec,
  opts: { dangling?: DanglingPolicy } = {},
): ScoredReferralGraph {
  const checked = assertSpec(spec);
  const policy: DanglingPolicy = opts.dangling ?? "score";
  const graph = buildReferralGraph(people, referrals);

  const incoming = new Map<string, ScoredEdge[]>();
  const outgoing = new Map<string, ScoredEdge[]>();
  for (const p of people) {
    incoming.set(p.id, []);
    outgoing.set(p.id, []);
  }

  const byReferralId = new Map<string, ScoredEdge>();
  const dangling: ScoredEdge[] = [];

  for (const referral of referrals) {
    const breakdown = referralStrengthBreakdown(referral, checked);
    const isDangling =
      !graph.nodes.has(referral.referrerId) || !graph.nodes.has(referral.candidateId);
    const edge: ScoredEdge = {
      referral,
      strength: breakdown.strength,
      breakdown,
      dangling: isDangling,
    };
    byReferralId.set(referral.id, edge);
    if (isDangling) dangling.push(edge);

    if (isDangling && policy === "drop") continue;
    // V0 drops self-referrals from the candidate's incoming evidence.
    if (referral.referrerId === referral.candidateId) continue;
    append(incoming, referral.candidateId, edge);
    append(outgoing, referral.referrerId, edge);
  }

  return {
    graph,
    in: incoming,
    out: outgoing,
    byReferralId,
    dangling,
    specVersion: checked.version,
    policy,
  };
}
