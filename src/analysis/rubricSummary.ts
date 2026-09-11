/**
 * Rubric summary — per-dimension description of stored rubric evaluations.
 * Structured Evidence is summarised here and feeds no score (MVP §12): the
 * mean is a description of what evaluators wrote, on the rubric's own 0–4
 * anchors, never combined with Referral Signal or Relative Capability.
 */

import { DIMENSIONS } from "../domain/constants.ts";
import type { Dimension, Evaluation } from "../domain/types.ts";

export interface RubricDimensionSummary {
  dimension: Dimension;
  /** Mean of non-null scores, or null when nobody scored the dimension. */
  mean: number | null;
  /** Evaluations with a numeric score. */
  scored: number;
  /** Evaluations recorded as not observed (score null). */
  notObserved: number;
  /** Distinct evaluators who wrote anything on the dimension. */
  evaluators: number;
}

export type RubricSummary = Record<Dimension, RubricDimensionSummary>;

export function summarizeEvaluations(evaluations: readonly Evaluation[]): RubricSummary {
  const out = {} as RubricSummary;
  for (const dimension of DIMENSIONS) {
    let sum = 0;
    let scored = 0;
    let notObserved = 0;
    const evaluators = new Set<string>();
    for (const e of evaluations) {
      if (e.dimension !== dimension) continue;
      evaluators.add(e.evaluatorId);
      if (e.score === null) notObserved++;
      else {
        scored++;
        sum += e.score;
      }
    }
    out[dimension] = {
      dimension,
      mean: scored === 0 ? null : sum / scored,
      scored,
      notObserved,
      evaluators: evaluators.size,
    };
  }
  return out;
}
