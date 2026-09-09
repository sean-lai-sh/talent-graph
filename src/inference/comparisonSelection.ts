/**
 * Comparison selection heuristic — which pair should an evaluator judge next?
 *
 *   Priority(i,j,k) = a·Uncertainty + b·Closeness + c·Novelty + d·Surprise
 *   Uncertainty     = 1 / (1 + min(n_i, n_j))          n = informative comparisons on k
 *   Closeness       = exp(−|θ_i − θ_j|)                 same component, both estimated
 *                   = 0.5                               either side insufficient (bootstrap)
 *                   = 0.5 · crossComponentBonus         different components (bridging)
 *   Novelty         = 1                                 pair never informatively compared on k
 *                   = min(1, daysSince(last) / 30)      otherwise
 *   Surprise        = max(s_i, s_j)                     per-person scores from the caller
 *                   = 0                                 no map or missing person id
 *
 * `s_i` is a caller-injected score in [0, 1] (e.g. ΔR* / IG computed outside
 * this module). Values outside [0, 1] are clamped; a missing person id is 0.
 * This file never imports `src/judges`, never computes residuals, and never
 * writes Comparison rows from outcomes. Default `d = 0` keeps existing
 * rankings bit-identical.
 *
 * Only informative outcomes consume novelty: "a" / "b", and "tie" when the
 * run's tieHandling is "half". A skip or insufficient_observation leaves the
 * pair as fresh as before — the evaluator could not judge it, so it should not
 * be pushed to the back of the queue.
 *
 * Heuristic, not optimal, and deliberately simple. `now` is a parameter.
 */

import { DIMENSION_PROMPTS } from "../domain/constants.ts";
import type { Comparison, Dimension } from "../domain/types.ts";
import {
  type CapabilityRun,
  type DimensionEstimate,
  isInformativeOutcome,
} from "./capabilityVector.ts";

export interface SelectionOptions {
  /** Excluded from every proposed pair. */
  evaluatorId?: string;
  now: Date;
  /** Default 10. */
  limit?: number;
  /** `d` defaults to 0 so rankings stay bit-identical without a surprise term. */
  weights?: { a?: number; b?: number; c?: number; d?: number };
  /** Default 1. Scales the 0.5 closeness given to cross-component pairs. */
  crossComponentBonus?: number;
  /** Restrict proposals to these ids (e.g. people the evaluator has observed). */
  candidatePool?: string[];
  /**
   * Per-person surprise in [0, 1], computed by the caller (e.g. ΔR* / IG).
   * Pair surprise is max(s_i, s_j); a missing id is 0. Out-of-range values
   * are clamped to [0, 1].
   */
  surprise?: ReadonlyMap<string, number>;
}

export interface ProposedComparison {
  personAId: string;
  personBId: string;
  dimension: Dimension;
  priority: number;
  parts: { uncertainty: number; closeness: number; novelty: number; surprise: number };
  prompt: string;
}

const DAY = 86_400_000;

/** Clamp a caller-supplied surprise score to [0, 1] without throwing. */
function clampUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Pair surprise is the max of the two people's scores. Missing ids are 0
 * (including when the caller omitted the map). Values are clamped to [0, 1].
 */
function pairSurprise(
  scores: ReadonlyMap<string, number> | undefined,
  i: string,
  j: string,
): number {
  if (scores === undefined) return 0;
  return Math.max(clampUnitInterval(scores.get(i) ?? 0), clampUnitInterval(scores.get(j) ?? 0));
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function selectComparisons(
  dimension: Dimension,
  run: CapabilityRun,
  comparisons: readonly Comparison[],
  opts: SelectionOptions,
): ProposedComparison[] {
  const limit = opts.limit ?? 10;
  const a = opts.weights?.a ?? 1;
  const b = opts.weights?.b ?? 1;
  const c = opts.weights?.c ?? 1;
  const d = opts.weights?.d ?? 0;
  const crossBonus = opts.crossComponentBonus ?? 1;
  const nowMs = opts.now.getTime();

  // Deduplicated so a repeated id can never be paired with itself.
  const pool = [...new Set(opts.candidatePool ?? [...run.vectors.keys()])]
    .filter((id) => id !== opts.evaluatorId && run.vectors.has(id))
    .sort();

  // Informative comparison counts and component ids from the fit.
  const fitById = new Map(run.runsByDimension[dimension].fits.map((f) => [f.personId, f] as const));
  const estimateOf = (id: string): DimensionEstimate | undefined =>
    run.vectors.get(id)?.dimensions[dimension];

  // Most recent informative comparison per unordered pair on this dimension.
  const tieHandling = run.options.tieHandling;
  const lastComparedMs = new Map<string, number>();
  for (const cmp of comparisons) {
    if (cmp.dimension !== dimension) continue;
    if (!isInformativeOutcome(cmp.outcome, tieHandling)) continue;
    const key = pairKey(cmp.personAId, cmp.personBId);
    const t = cmp.createdAt.getTime();
    const prev = lastComparedMs.get(key);
    if (prev === undefined || t > prev) lastComparedMs.set(key, t);
  }

  const proposals: ProposedComparison[] = [];
  for (let x = 0; x < pool.length; x++) {
    for (let y = x + 1; y < pool.length; y++) {
      const i = pool[x] as string;
      const j = pool[y] as string;
      const fi = fitById.get(i);
      const fj = fitById.get(j);
      const ni = fi?.comparisonCount ?? 0;
      const nj = fj?.comparisonCount ?? 0;
      const uncertainty = 1 / (1 + Math.min(ni, nj));

      const ei = estimateOf(i);
      const ej = estimateOf(j);
      let closeness: number;
      if (ei?.state === "estimated" && ej?.state === "estimated") {
        closeness =
          ei.componentId === ej.componentId
            ? Math.exp(-Math.abs(ei.theta - ej.theta))
            : 0.5 * crossBonus;
      } else {
        closeness = 0.5;
      }

      const last = lastComparedMs.get(pairKey(i, j));
      const novelty = last === undefined ? 1 : Math.min(1, Math.max(0, (nowMs - last) / DAY) / 30);
      const surprise = pairSurprise(opts.surprise, i, j);
      // When d is 0 the extra term is omitted so default rankings stay
      // bit-identical, including if a surprise map is present but unused.
      const priority =
        d === 0
          ? a * uncertainty + b * closeness + c * novelty
          : a * uncertainty + b * closeness + c * novelty + d * surprise;

      proposals.push({
        personAId: i,
        personBId: j,
        dimension,
        priority,
        parts: { uncertainty, closeness, novelty, surprise },
        prompt: DIMENSION_PROMPTS[dimension],
      });
    }
  }

  proposals.sort(
    (p, q) =>
      q.priority - p.priority ||
      (p.personAId < q.personAId ? -1 : p.personAId > q.personAId ? 1 : 0) ||
      (p.personBId < q.personBId ? -1 : p.personBId > q.personBId ? 1 : 0),
  );
  return proposals.slice(0, limit);
}
