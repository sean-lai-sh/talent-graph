/**
 * `EdgeWeighting` — how one scored edge R_uv becomes the contribution that
 * enters S_v.
 *
 * Before this module the Referral Signal loop hard-coded two branches: the V0
 * path (contribution = R_uv) and the V2 judge path
 * (contribution = p̂_u · clip(R_uv − b̂_u, 0, 1)). Both are extracted here
 * verbatim, as `IDENTITY_WEIGHTING` and `judgeWeighting`, so the arithmetic is
 * unchanged and later phases can add a weighting instead of editing the loop.
 *
 * A weighting is pure, per-edge and spec-free: it reads an already scored edge
 * and returns a number plus the intermediates an explanation needs. It never
 * computes p̂_u — the maps are passed in by the caller (see `src/judges/`), so
 * `src/scoring` still imports nothing from `src/judges`.
 */

import type { ScoredEdge } from "./scoredGraph.ts";

export interface EdgeWeightingResult {
  /** The value that enters the Top-K mean in place of R_uv. */
  contribution: number;
  /** false ⇒ this edge may not occupy a Top-K slot (today's zero-reliability rule). */
  eligible: boolean;
  /** Intermediates for the explanation UI, e.g. { reliability, bias, adjusted }. */
  factors: Readonly<Record<string, number>>;
}

/** Turns R_uv into the contribution entering S_v. Pure, per-edge, spec-free. */
export interface EdgeWeighting {
  /** Stable name for provenance: "identity", "judge_v2", … */
  readonly kind: string;
  /** `weighted: false` ⇒ `ReferralSignalResult.judgeWeighted` stays false. */
  readonly weighted: boolean;
  weigh(edge: ScoredEdge): EdgeWeightingResult;
}

/**
 * The V0 path: contribution === edge.strength, always eligible, weighted false.
 *
 * `factors` reports the neutral judge intermediates (p̂ = 1, b̂ = 0, adjusted =
 * R_uv). Those are exactly the values the pre-refactor loop stored in
 * `ContributingReferral.judge` when no judge maps were given, so the view shape
 * is unchanged. They are neutral elements, not a stand-in for a missing value.
 */
export const IDENTITY_WEIGHTING: EdgeWeighting = {
  kind: "identity",
  weighted: false,
  weigh(edge: ScoredEdge): EdgeWeightingResult {
    return {
      contribution: edge.strength,
      eligible: true,
      factors: { reliability: 1, bias: 0, adjusted: edge.strength },
    };
  },
};

function clip01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * The V2 judge path, bit for bit: `p̂_u · clip(R_uv − b̂_u, 0, 1)`.
 *
 * A judge absent from a map is not a judge with a weight of 0: it is a judge
 * with no calibration, which is the neutral element (p̂ = 1, b̂ = 0).
 *
 * Validation happens here, per edge, at the same point in the loop as before
 * the refactor: a reliability outside [0, 1] or a non-finite bias throws rather
 * than being clipped, because a weight out of range is a caller bug.
 *
 * A judge with p̂_u = 0 is `eligible: false` — it must not occupy a Top-K slot
 * nor dilute the mean with a zero.
 */
export function judgeWeighting(opts: {
  reliability?: ReadonlyMap<string, number>;
  bias?: ReadonlyMap<string, number>;
}): EdgeWeighting {
  const { reliability: reliabilityMap, bias: biasMap } = opts;
  return {
    kind: "judge_v2",
    weighted: true,
    weigh(edge: ScoredEdge): EdgeWeightingResult {
      const referrerId = edge.referral.referrerId;
      const reliability = reliabilityMap?.get(referrerId) ?? 1;
      const bias = biasMap?.get(referrerId) ?? 0;
      if (!(reliability >= 0 && reliability <= 1) || !Number.isFinite(bias)) {
        throw new Error(
          `judgeWeighting: judge ${referrerId} has reliability ${reliability}, bias ${bias}`,
        );
      }
      const adjusted = bias === 0 ? edge.strength : clip01(edge.strength - bias);
      const contribution = reliability === 1 ? adjusted : reliability * adjusted;
      return {
        contribution,
        eligible: reliability > 0,
        factors: { reliability, bias, adjusted },
      };
    },
  };
}

/**
 * Compose weightings into a pipeline, left to right.
 *
 * Each weighting weighs the edge as re-strengthed by the previous one's
 * contribution: weighting *i* sees `{ ...edge, strength: contribution_{i-1} }`.
 * This is a fold, not a product of ratios, so no division by `edge.strength` is
 * introduced and a zero-strength edge stays exact rather than becoming NaN.
 *
 * The other fields combine as:
 *
 *   - `eligible` — AND. One veto is enough to keep an edge out of Top-K.
 *   - `weighted` — OR. Any non-identity stage makes the result judge-weighted.
 *   - `kind`     — `compose(a,b,…)`.
 *   - `factors`  — merged left to right, later stages winning on a shared key,
 *     plus every stage's own keys under `<kind>.<key>` for provenance.
 *
 * Composition is therefore order-sensitive in `factors` (and in arithmetic once
 * a stage is non-linear), which is why `composeWeightings(IDENTITY_WEIGHTING,
 * w)` is the identity of the composition and `composeWeightings(w,
 * IDENTITY_WEIGHTING)` is only equal to `w` in `contribution`, not in every
 * factor key. With no arguments it is `IDENTITY_WEIGHTING`; with one it is that
 * weighting unchanged.
 */
export function composeWeightings(...weightings: readonly EdgeWeighting[]): EdgeWeighting {
  if (weightings.length === 0) return IDENTITY_WEIGHTING;
  const only = weightings[0];
  if (weightings.length === 1 && only !== undefined) return only;
  const stages = [...weightings];
  return {
    kind: `compose(${stages.map((w) => w.kind).join(",")})`,
    weighted: stages.some((w) => w.weighted),
    weigh(edge: ScoredEdge): EdgeWeightingResult {
      let current = edge;
      let eligible = true;
      const factors: Record<string, number> = {};
      for (const stage of stages) {
        const step = stage.weigh(current);
        eligible = eligible && step.eligible;
        for (const [key, value] of Object.entries(step.factors)) {
          factors[key] = value;
          factors[`${stage.kind}.${key}`] = value;
        }
        current = { ...current, strength: step.contribution };
      }
      return { contribution: current.strength, eligible, factors };
    },
  };
}
