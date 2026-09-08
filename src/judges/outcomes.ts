/**
 * Longitudinal outcomes → opportunity-corrected residual "truth" per person.
 *
 * From the white paper ("Longitudinal Observation"):
 *
 *   R_v      realised outcome (rank-normalised within its kind, so units are free)
 *   R*_v   = R_v − E[R_v | O_v]                  residual after opportunity
 *   truth_v = rank percentile of R*_v / 100      ∈ [0, 1], comparable to x_uv
 *
 * E[R_v | O_v] is the mean normalised outcome of people with a similar
 * opportunity count (bucketed by the spec's thresholds). A bucket smaller than
 * `minBucketSize` falls back to the global mean. With no opportunity records,
 * every person is in one bucket, the expectation is a constant, and the
 * residual ranking equals the raw outcome ranking.
 *
 * Pure: `now` is a parameter. Only outcomes observed at or before `now` count.
 */

import { rankPercentiles } from "../domain/rank.ts";
import type { Opportunity, Outcome } from "../domain/types.ts";
import type { JudgeReliabilitySpec } from "../models/spec.ts";

export interface ResidualOutcome {
  personId: string;
  /** Mean rank-normalised outcome across this person's outcomes, in [0, 1]. */
  normalized: number;
  /** Opportunities that started at or before the latest outcome used. */
  opportunityCount: number;
  /** E[R_v | O_v] for this person's bucket. */
  expected: number;
  /** R*_v = normalized − expected. */
  residual: number;
  /** Rank percentile of the residual among evaluated people, divided by 100. */
  truth: number;
  /** Outcomes that contributed, ids sorted. */
  outcomeIds: string[];
  /** Latest `observedAt` among contributing outcomes. */
  latestObservedAt: Date;
}

/** Bucket index for an opportunity count under the spec's thresholds. */
export function opportunityBucket(count: number, thresholds: readonly number[]): number {
  let bucket = 0;
  for (const t of thresholds) {
    if (count >= t) bucket++;
    else break;
  }
  return bucket;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Residual truth for every person with at least one measurable outcome
 * observed at or before `now`.
 */
export function residualOutcomes(
  outcomes: readonly Outcome[],
  opportunities: readonly Opportunity[],
  spec: JudgeReliabilitySpec,
  now: Date,
): Map<string, ResidualOutcome> {
  const nowMs = now.getTime();
  const usable = outcomes.filter(
    (o) => o.value !== null && Number.isFinite(o.value) && o.observedAt.getTime() <= nowMs,
  );
  if (usable.length === 0) return new Map();

  // 1. Rank-normalise within kind so different units become comparable.
  const byKind = new Map<string, Outcome[]>();
  for (const o of usable) {
    const list = byKind.get(o.kind);
    if (list) list.push(o);
    else byKind.set(o.kind, [o]);
  }
  const normalizedById = new Map<string, number>();
  for (const list of byKind.values()) {
    const pct = rankPercentiles(list.map((o) => ({ id: o.id, value: o.value as number })));
    for (const [id, p] of pct) normalizedById.set(id, p / 100);
  }

  // 2. One normalised value per person: the mean across their outcomes.
  const byPerson = new Map<string, Outcome[]>();
  for (const o of usable) {
    const list = byPerson.get(o.personId);
    if (list) list.push(o);
    else byPerson.set(o.personId, [o]);
  }

  interface Partial {
    personId: string;
    normalized: number;
    opportunityCount: number;
    outcomeIds: string[];
    latestObservedAt: Date;
  }
  const partials: Partial[] = [];
  for (const [personId, list] of byPerson) {
    const latest = list.reduce(
      (acc, o) => (o.observedAt.getTime() > acc ? o.observedAt.getTime() : acc),
      Number.NEGATIVE_INFINITY,
    );
    const opportunityCount = opportunities.filter(
      (op) => op.personId === personId && op.startedAt.getTime() <= latest,
    ).length;
    partials.push({
      personId,
      normalized: mean(list.map((o) => normalizedById.get(o.id) as number)),
      opportunityCount,
      outcomeIds: list.map((o) => o.id).sort(),
      latestObservedAt: new Date(latest),
    });
  }

  // 3. Expectation given opportunity: bucket mean, else global mean.
  const globalMean = mean(partials.map((p) => p.normalized));
  const bucketValues = new Map<number, number[]>();
  for (const p of partials) {
    const b = opportunityBucket(p.opportunityCount, spec.opportunityBuckets);
    const list = bucketValues.get(b);
    if (list) list.push(p.normalized);
    else bucketValues.set(b, [p.normalized]);
  }
  const expectedFor = (p: Partial): number => {
    const values = bucketValues.get(opportunityBucket(p.opportunityCount, spec.opportunityBuckets));
    return values && values.length >= spec.minBucketSize ? mean(values) : globalMean;
  };

  // 4. Residual and its percentile among evaluated people.
  const residuals = partials.map((p) => ({ id: p.personId, value: p.normalized - expectedFor(p) }));
  const truthPct = rankPercentiles(residuals);

  const out = new Map<string, ResidualOutcome>();
  for (const p of partials) {
    const expected = expectedFor(p);
    out.set(p.personId, {
      personId: p.personId,
      normalized: p.normalized,
      opportunityCount: p.opportunityCount,
      expected,
      residual: p.normalized - expected,
      truth: (truthPct.get(p.personId) as number) / 100,
      outcomeIds: p.outcomeIds,
      latestObservedAt: p.latestObservedAt,
    });
  }
  return out;
}
