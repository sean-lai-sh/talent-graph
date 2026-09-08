/**
 * Percentile of θ within a pool. Rank-based, ties averaged; the same rule the
 * referral percentile uses (src/domain/rank.ts), so the under-recognition
 * gap subtracts like from like.
 *
 *   pct = 100 · (rank − 1) / (n − 1)   for n ≥ 2
 *   pct = 50                            for n = 1 (callers mark this insufficient)
 */

import { rankPercentiles } from "../domain/rank.ts";

export function percentileWithin(
  values: ReadonlyArray<{ id: string; theta: number }>,
): Map<string, number> {
  return rankPercentiles(values.map((v) => ({ id: v.id, value: v.theta })));
}
