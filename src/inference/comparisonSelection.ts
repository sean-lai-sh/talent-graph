/**
 * Comparison selection heuristic — which pair should an evaluator judge next?
 *
 *   Priority(i,j,k) = a·Uncertainty + b·Closeness + c·Novelty
 *   Uncertainty     = 1 / (1 + min(n_i, n_j))          n = informative comparisons on k
 *   Closeness       = exp(−|θ_i − θ_j|)                 same component, both estimated
 *                   = 0.5                               either side insufficient (bootstrap)
 *                   = 0.5 · crossComponentBonus         different components (bridging)
 *   Novelty         = 1                                 pair never compared on k by anyone
 *                   = min(1, daysSince(last) / 30)      otherwise
 *
 * Heuristic, not optimal, and deliberately simple. `now` is a parameter.
 */

import { DIMENSION_PROMPTS } from "../domain/constants.ts";
import type { Comparison, Dimension } from "../domain/types.ts";
import type { CapabilityRun, DimensionEstimate } from "./capabilityVector.ts";

export interface SelectionOptions {
  /** Excluded from every proposed pair. */
  evaluatorId?: string;
  now: Date;
  /** Default 10. */
  limit?: number;
  weights?: { a?: number; b?: number; c?: number };
  /** Default 1. Scales the 0.5 closeness given to cross-component pairs. */
  crossComponentBonus?: number;
  /** Restrict proposals to these ids (e.g. people the evaluator has observed). */
  candidatePool?: string[];
}

export interface ProposedComparison {
  personAId: string;
  personBId: string;
  dimension: Dimension;
  priority: number;
  parts: { uncertainty: number; closeness: number; novelty: number };
  prompt: string;
}

const DAY = 86_400_000;

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
  const crossBonus = opts.crossComponentBonus ?? 1;
  const nowMs = opts.now.getTime();

  const pool = (opts.candidatePool ?? [...run.vectors.keys()])
    .filter((id) => id !== opts.evaluatorId && run.vectors.has(id))
    .sort();

  // Informative comparison counts and component ids from the fit.
  const fitById = new Map(run.runsByDimension[dimension].fits.map((f) => [f.personId, f] as const));
  const estimateOf = (id: string): DimensionEstimate | undefined =>
    run.vectors.get(id)?.dimensions[dimension];

  // Most recent comparison per unordered pair on this dimension (any outcome).
  const lastComparedMs = new Map<string, number>();
  for (const cmp of comparisons) {
    if (cmp.dimension !== dimension) continue;
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

      proposals.push({
        personAId: i,
        personBId: j,
        dimension,
        priority: a * uncertainty + b * closeness + c * novelty,
        parts: { uncertainty, closeness, novelty },
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
