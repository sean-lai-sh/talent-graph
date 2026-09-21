/**
 * Referral Signal S_v — the only V0 score.
 *
 *   p_u   = 1 for every referrer (judge reliability is not learned in V0/V1)
 *   TopK(v) = up to K incoming referrals with the largest R_uv
 *             (ties: earlier createdAt first, then id)
 *   S_v   = |TopK(v)| > 0 ? mean(R_uv, u ∈ TopK(v)) : 0
 *   ReferralSignal_v = 100 · S_v      // float; rounded only for display
 *
 * V2 hook (judge calibration): a caller may pass per-judge reliability p̂_u and
 * bias b̂_u maps. Each referral's contribution becomes
 *
 *   x*_uv = clip(R_uv − b̂_u, 0, 1) ;  contribution = p̂_u · x*_uv
 *
 * With no maps (or p̂_u = 1, b̂_u = 0) this is exactly R_uv, so V0 is
 * reproduced bit-for-bit. This module never computes p̂_u itself; see
 * src/judges/. Inputs are referrals plus optional judge weights. Rubric
 * evaluations, comparisons, affiliation and bio are not parameters.
 *
 * Both paths now go through one `EdgeWeighting` (see ./weighting.ts): V0 is
 * `IDENTITY_WEIGHTING` and V2 is `judgeWeighting(...)`, which the judge maps
 * still construct as sugar. The loop below applies whichever it is given, so a
 * later weighting is added there and not here.
 *
 * Since #56 T5 the many-person path reads the shared index rather than
 * re-deriving one of its own: `computeAllReferralSignals` is
 * `scoreReferralGraph(...)` followed by `computeSignalsFromGraph(...)`, so R_uv
 * is computed exactly once per referral per run and the signal and the graph
 * can no longer disagree about a strength. `computeReferralSignal` keeps its
 * (personId, referrals) signature for the single-person path. Both share one
 * per-person core, `signalFromScoredEdges`, so neither can drift; the numbers
 * are unchanged, which is what the T1 golden pins.
 */

import { FIRSTHAND_EVIDENCE_TYPES } from "../domain/constants.ts";
import type { EvidenceType, Person, Referral } from "../domain/types.ts";
import { CURRENT_SPECS } from "../models/registry.ts";
import { assertSpec, type ReferralSignalSpec } from "../models/spec.ts";
import { type ReferralStrengthBreakdown, referralStrengthBreakdown } from "./referralStrength.ts";
import { type ScoredEdge, type ScoredReferralGraph, scoreReferralGraph } from "./scoredGraph.ts";
import { type EdgeWeighting, IDENTITY_WEIGHTING, judgeWeighting } from "./weighting.ts";

export const REFERRAL_SIGNAL_EXPLANATION =
  "Referral Signal summarizes the current strength of referral evidence. It is not an objective measure of ability.";

export interface ContributingReferral {
  referral: Referral;
  /** R_uv */
  strength: number;
  /**
   * Every intermediate of R_uv under the spec that produced this result, so
   * explanations never have to re-derive it with a possibly different spec.
   * `breakdown.strength` is the unweighted R_uv; `strength` above is the
   * judge-weighted contribution (identical when no judge weights are given).
   */
  breakdown: ReferralStrengthBreakdown;
  /** Judge weighting applied to this referral (1 / 0 / R_uv when none). */
  judge: { reliability: number; bias: number; adjusted: number };
}

export interface ReferralSignalResult {
  personId: string;
  /** 100 · S_v, unrounded. */
  signal: number;
  /** S_v ∈ [0, 1]. */
  s: number;
  /** TopK, sorted by strength descending. */
  contributing: ContributingReferral[];
  incomingCount: number;
  /** |TopK| */
  usedCount: number;
  /** Incoming referrals whose evidence is firsthand (work or personal). */
  firsthandCount: number;
  /** max R_uv over all incoming (unweighted, even under V2 weights), or null when none. */
  strongest: number | null;
  /** Distinct evidence types among all incoming, in canonical order of first appearance. */
  evidenceTypes: EvidenceType[];
  explanation: string;
  /** Spec that produced the number, for provenance. */
  specVersion: string;
  /** The weighting's own `weighted` flag: true when a non-identity weighting ran (V2). */
  judgeWeighted: boolean;
}

export interface ReferralSignalOptions {
  spec?: ReferralSignalSpec;
  /** Overrides `spec.topK`. Prefer passing a spec. */
  topK?: number;
  /**
   * How R_uv becomes the contribution entering S_v. Defaults to
   * `IDENTITY_WEIGHTING`, i.e. the V0 path. Mutually exclusive with the
   * `judgeReliability` / `judgeBias` sugar below: passing both would silently
   * weight twice, so it throws.
   */
  weighting?: EdgeWeighting;
  /** p̂_u per judge id from V2 calibration; missing judges count as 1. */
  judgeReliability?: ReadonlyMap<string, number>;
  /** b̂_u per judge id from V2 calibration; missing judges count as 0. */
  judgeBias?: ReadonlyMap<string, number>;
}

/**
 * The weighting a call runs under. The judge maps are kept as sugar for
 * `judgeWeighting(...)` so no existing caller changes; either map being present
 * (even empty) selects the judge path, exactly as before the refactor.
 */
function resolveWeighting(opts: ReferralSignalOptions): EdgeWeighting {
  const sugar = opts.judgeReliability !== undefined || opts.judgeBias !== undefined;
  if (opts.weighting !== undefined) {
    if (sugar) {
      throw new Error(
        "computeReferralSignal: pass either `weighting` or `judgeReliability`/`judgeBias`, not both",
      );
    }
    return opts.weighting;
  }
  if (!sugar) return IDENTITY_WEIGHTING;
  const maps: { reliability?: ReadonlyMap<string, number>; bias?: ReadonlyMap<string, number> } =
    {};
  if (opts.judgeReliability !== undefined) maps.reliability = opts.judgeReliability;
  if (opts.judgeBias !== undefined) maps.bias = opts.judgeBias;
  return judgeWeighting(maps);
}

function compareContributing(a: ContributingReferral, b: ContributingReferral): number {
  if (b.strength !== a.strength) return b.strength - a.strength;
  const dt = a.referral.createdAt.getTime() - b.referral.createdAt.getTime();
  if (dt !== 0) return dt;
  return a.referral.id < b.referral.id ? -1 : a.referral.id > b.referral.id ? 1 : 0;
}

/**
 * The one per-person computation, shared by every entry point.
 *
 * `incoming` is already exactly the V0 incoming set for `personId`: the
 * referrals naming them as candidate, self-referrals excluded, in the input
 * order of the original referral array. That ordering is load-bearing —
 * `compareContributing` falls through to it for equal (strength, createdAt,
 * id), and the Top-K mean below sums in the resulting order, so a reordering
 * would move the last bits of S_v.
 *
 * Both the single-person path and the graph path funnel through here so they
 * cannot drift apart; the only difference between them is where the
 * `ScoredEdge`s come from.
 */
function signalFromScoredEdges(
  personId: string,
  incoming: readonly ScoredEdge[],
  spec: ReferralSignalSpec,
  topK: number,
  weighting: EdgeWeighting,
): ReferralSignalResult {
  const judgeWeighted = weighting.weighted;
  const weighed = incoming
    .map((edge): { c: ContributingReferral; eligible: boolean } => {
      const breakdown = edge.breakdown;
      const w = weighting.weigh(edge);
      return {
        c: {
          referral: edge.referral,
          strength: w.contribution,
          breakdown,
          // `judge` is the view shape; `factors` is a superset of it. A
          // weighting that reports no judge intermediate is not a judge with a
          // weight of 0 — it is the neutral element (p̂ = 1, b̂ = 0, adjusted = R_uv).
          judge: {
            reliability: w.factors.reliability ?? 1,
            bias: w.factors.bias ?? 0,
            adjusted: w.factors.adjusted ?? breakdown.strength,
          },
        },
        eligible: w.eligible,
      };
    })
    .sort((a, b) => compareContributing(a.c, b.c));
  const scored = weighed.map((x) => x.c);

  // An ineligible edge (today: a zero-reliability judge) must not occupy a
  // Top-K slot or dilute the mean.
  const contributing = weighed
    .filter((x) => x.eligible)
    .slice(0, topK)
    .map((x) => x.c);
  const s =
    contributing.length === 0
      ? 0
      : contributing.reduce((acc, c) => acc + c.strength, 0) / contributing.length;

  const evidenceTypes: EvidenceType[] = [];
  for (const { referral } of scored) {
    if (!evidenceTypes.includes(referral.evidenceType)) evidenceTypes.push(referral.evidenceType);
  }

  return {
    personId,
    signal: 100 * s,
    s,
    contributing,
    incomingCount: incoming.length,
    usedCount: contributing.length,
    firsthandCount: incoming.filter((e) =>
      FIRSTHAND_EVIDENCE_TYPES.includes(e.referral.evidenceType),
    ).length,
    // Raw max R_uv, independent of judge weighting (the documented contract).
    strongest: scored.length === 0 ? null : Math.max(...scored.map((c) => c.breakdown.strength)),
    evidenceTypes,
    explanation: REFERRAL_SIGNAL_EXPLANATION,
    specVersion: spec.version,
    judgeWeighted,
  };
}

/** Referral Signal for one person from the referrals that name them as candidate. */
export function computeReferralSignal(
  personId: string,
  referrals: readonly Referral[],
  opts: ReferralSignalOptions = {},
): ReferralSignalResult {
  const spec = assertSpec(opts.spec ?? CURRENT_SPECS.referral_signal);
  const topK = opts.topK ?? spec.topK;

  // Defensive: a self-referral should already be rejected by validateReferral.
  const incoming = referrals.filter((r) => r.candidateId === personId && r.referrerId !== personId);

  // This path is given referrals, not a node set, so there is no graph to read
  // a `dangling` flag from and no node set to make one meaningful: every
  // referral here is incoming evidence, exactly as in V0. The edges are built
  // inline from each referral's own breakdown, which is the same arithmetic in
  // the same order as `scoreReferralGraph` would produce for them.
  const edges = incoming.map((referral): ScoredEdge => {
    const breakdown = referralStrengthBreakdown(referral, spec);
    return { referral, strength: breakdown.strength, breakdown, dangling: false };
  });

  return signalFromScoredEdges(personId, edges, spec, topK, resolveWeighting(opts));
}

/**
 * Referral Signal for every person in a scored graph — the primary entry point.
 *
 * Signals now read the same index the graph reads: R_uv is computed once, by
 * `scoreReferralGraph`, and this function only weighs, ranks and averages what
 * is already there. `sg.in` is exactly V0's incoming filter (candidate matches,
 * self-referrals dropped, dangling referrers kept under the default `"score"`
 * policy) in the input order of the referral array, so the numbers are V0's bit
 * for bit.
 *
 * `spec` is not an option here: the spec is whichever one `sg` was scored
 * under, so a historical index reproduces its own numbers and no call can mix
 * two specs in one result.
 *
 * Which people get a result: every node of `sg.graph`, in `people` order. Not
 * `sg.in.keys()`, which under `"score"` also carries keys for unknown ids that
 * were never people. A person with no incoming edges gets today's empty-evidence
 * result (`s = 0`, `strongest: null`, `evidenceTypes: []`) — absence is not
 * reshaped into a score, and the `null` is never a 0.
 */
export function computeSignalsFromGraph(
  sg: ScoredReferralGraph,
  opts: Omit<ReferralSignalOptions, "spec"> = {},
): Map<string, ReferralSignalResult> {
  const spec = sg.spec;
  const topK = opts.topK ?? spec.topK;
  const weighting = resolveWeighting(opts);
  const out = new Map<string, ReferralSignalResult>();
  for (const personId of sg.graph.nodes.keys()) {
    out.set(
      personId,
      signalFromScoredEdges(personId, sg.in.get(personId) ?? [], spec, topK, weighting),
    );
  }
  return out;
}

/** Referral Signal for every person, keyed by person id. */
export function computeAllReferralSignals(
  people: readonly Person[],
  referrals: readonly Referral[],
  opts: ReferralSignalOptions = {},
): Map<string, ReferralSignalResult> {
  const spec = assertSpec(opts.spec ?? CURRENT_SPECS.referral_signal);
  // `"score"` is the V0 dangling rule and the default; it is spelled out here
  // because this function must reproduce V0 and not follow a changed default.
  const sg = scoreReferralGraph(people, referrals, spec, { dangling: "score" });
  const { spec: _ignored, ...rest } = opts;
  return computeSignalsFromGraph(sg, rest);
}

/** Integer 0..100 for display. The only place rounding happens. */
export function displayReferralSignal(r: ReferralSignalResult): number {
  return Math.round(r.signal);
}
