/**
 * Longitudinal outcomes → opportunity-corrected residual labels.
 *
 * From the white paper ("Longitudinal Observation"):
 *
 *   R_v      realised outcome, rank-normalised within its kind (units are free)
 *   R*_v   = R_v − E[R_v | O_v]                 residual after opportunity
 *   truth_v = rank percentile of R*_v / 100     ∈ [0, 1], comparable to x_uv
 *
 * Two views:
 *
 * - `residualOutcomes` — person-level snapshot at T for reporting: every usable
 *   outcome ≤ T, opportunities on the latest-outcome clock.
 * - `labelForPrediction` — the label a referral u → v is scored against. Built
 *   from a **causal cohort** at the referral: only outcomes observed after it
 *   (and ≤ T), kind ranks / bucket means / residual percentiles all computed
 *   on that same cutoff. Pre-referral track record cannot move E_uv, even
 *   through the scale. The paper's observation window is `T − t_uv`; an
 *   outcome shortly after the referral is kept once T has cleared the window.
 *   Opportunities default to the referral clock so a referral-caused
 *   fellowship is not subtracted from the judge's credit.
 *
 * E[R_v | O_v] is the mean normalised outcome of the cohort bucket with a
 * similar opportunity count; a bucket smaller than `minBucketSize` falls back
 * to the global mean. Kinds with fewer than `minKindSize` outcomes are dropped
 * because a rank inside a one- or two-row kind carries no information.
 *
 * Pure: `now` is a parameter. Only outcomes observed at or before `now` count.
 */

import { rankPercentiles } from "../domain/rank.ts";
import type { Opportunity, Outcome } from "../domain/types.ts";
import type { JudgeReliabilitySpec } from "../models/spec.ts";

export interface ResidualOutcome {
  personId: string;
  /** Mean rank-normalised outcome across this person's usable outcomes, in [0, 1]. */
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

/** The label one referral is scored against. */
export interface PredictionLabel {
  personId: string;
  /** Mean normalised value over the post-referral outcomes only. */
  normalized: number;
  /** Opportunities counted on the spec's clock (referral by default). */
  opportunityCount: number;
  expected: number;
  residual: number;
  /** Rank percentile of the residual within the cohort, divided by 100. */
  truth: number;
  outcomeIds: string[];
  /** Earliest post-referral outcome that contributes to the label at T. */
  firstObservedAt: Date;
  /**
   * First instant a causal cohort could have produced a label: the candidate
   * has a later outcome *and* that outcome's kind has reached `minKindSize`.
   * EWMA order uses this, not `firstObservedAt`, so a delayed kind does not
   * insert a prediction into the past.
   */
  firstEligibleAt: Date;
  latestObservedAt: Date;
}

/**
 * Cutoff for a causal (per-prediction) cohort. Omit for the reporting snapshot
 * at `now`.
 */
export interface ResidualClock {
  /** Only outcomes with `observedAt > after` are used. */
  after: Date;
  /**
   * Count every person's opportunities at this instant. Omit to use each
   * person's latest contributing outcome (the snapshot / `"outcome"` clock).
   */
  opportunityAsOf?: Date;
}

/** Cohort statistics at time T, shared by the snapshot and by per-prediction labels. */
export interface OutcomeCohort {
  now: Date;
  spec: JudgeReliabilitySpec;
  /** Raw outcomes passed in (unfiltered); used to rebuild a causal cohort. */
  outcomes: readonly Outcome[];
  /** Usable outcomes (measurable, ≤ now, kind large enough, after the clock) per person. */
  usableByPerson: Map<string, Outcome[]>;
  /** Within-kind rank normalisation of every usable outcome. */
  normalizedById: Map<string, number>;
  opportunities: readonly Opportunity[];
  /** Mean normalised value per opportunity bucket, with the bucket size. */
  bucketMeans: Map<number, { mean: number; size: number }>;
  globalMean: number;
  /** Person-level snapshot residuals (reference distribution for labels). */
  snapshot: Map<string, ResidualOutcome>;
  /** Kinds dropped for having fewer than `minKindSize` outcomes. */
  droppedKinds: string[];
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
 * Rank percentile (in [0, 1]) of `x` when inserted into `others`, with the
 * same average-rank rule as `rankPercentiles`. A value equal to a member of a
 * snapshot distribution therefore gets exactly that member's percentile.
 */
export function percentileAmong(others: readonly number[], x: number): number {
  const n = others.length + 1;
  if (n < 2) return 0.5;
  let below = 0;
  let equal = 0;
  for (const o of others) {
    if (o < x) below++;
    else if (o === x) equal++;
  }
  return (below + equal / 2) / (n - 1);
}

function countOpportunities(
  opportunities: readonly Opportunity[],
  personId: string,
  atOrBeforeMs: number,
): number {
  return opportunities.filter(
    (op) => op.personId === personId && op.startedAt.getTime() <= atOrBeforeMs,
  ).length;
}

/** Build the cohort at `now`, optionally restricted to a causal clock. */
export function buildOutcomeCohort(
  outcomes: readonly Outcome[],
  opportunities: readonly Opportunity[],
  spec: JudgeReliabilitySpec,
  now: Date,
  clock?: ResidualClock,
): OutcomeCohort {
  const nowMs = now.getTime();
  const afterMs = clock ? clock.after.getTime() : Number.NEGATIVE_INFINITY;
  const opportunityAsOfMs = clock?.opportunityAsOf?.getTime();
  const measurable = outcomes.filter((o) => {
    if (o.value === null || !Number.isFinite(o.value)) return false;
    const t = o.observedAt.getTime();
    return t <= nowMs && t > afterMs;
  });

  // 1. Rank-normalise within kind; drop kinds too small to carry a rank.
  const byKind = new Map<string, Outcome[]>();
  for (const o of measurable) {
    const list = byKind.get(o.kind);
    if (list) list.push(o);
    else byKind.set(o.kind, [o]);
  }
  const normalizedById = new Map<string, number>();
  const droppedKinds: string[] = [];
  for (const [kind, list] of byKind) {
    if (list.length < spec.minKindSize) {
      droppedKinds.push(kind);
      continue;
    }
    const pct = rankPercentiles(list.map((o) => ({ id: o.id, value: o.value as number })));
    for (const [id, p] of pct) normalizedById.set(id, p / 100);
  }
  droppedKinds.sort();

  const usableByPerson = new Map<string, Outcome[]>();
  for (const o of measurable) {
    if (!normalizedById.has(o.id)) continue;
    const list = usableByPerson.get(o.personId);
    if (list) list.push(o);
    else usableByPerson.set(o.personId, [o]);
  }

  // 2. Person-level snapshot values and their opportunity count (latest-outcome clock).
  interface Partial {
    personId: string;
    normalized: number;
    opportunityCount: number;
    outcomeIds: string[];
    latestObservedAt: Date;
  }
  const partials: Partial[] = [];
  for (const [personId, list] of usableByPerson) {
    const latest = Math.max(...list.map((o) => o.observedAt.getTime()));
    partials.push({
      personId,
      normalized: mean(list.map((o) => normalizedById.get(o.id) as number)),
      opportunityCount: countOpportunities(opportunities, personId, opportunityAsOfMs ?? latest),
      outcomeIds: list.map((o) => o.id).sort(),
      latestObservedAt: new Date(latest),
    });
  }

  // 3. Expectation given opportunity: bucket means over the snapshot.
  const globalMean = mean(partials.map((p) => p.normalized));
  const bucketValues = new Map<number, number[]>();
  for (const p of partials) {
    const b = opportunityBucket(p.opportunityCount, spec.opportunityBuckets);
    const list = bucketValues.get(b);
    if (list) list.push(p.normalized);
    else bucketValues.set(b, [p.normalized]);
  }
  const bucketMeans = new Map<number, { mean: number; size: number }>();
  for (const [b, values] of bucketValues) {
    bucketMeans.set(b, { mean: mean(values), size: values.length });
  }
  const expectedFor = (opportunityCount: number): number => {
    const b = bucketMeans.get(opportunityBucket(opportunityCount, spec.opportunityBuckets));
    return b && b.size >= spec.minBucketSize ? b.mean : globalMean;
  };

  // 4. Snapshot residuals and their percentiles.
  const residuals = partials.map((p) => ({
    id: p.personId,
    value: p.normalized - expectedFor(p.opportunityCount),
  }));
  const truthPct = rankPercentiles(residuals);
  const snapshot = new Map<string, ResidualOutcome>();
  for (const p of partials) {
    const expected = expectedFor(p.opportunityCount);
    snapshot.set(p.personId, {
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

  return {
    now: new Date(nowMs),
    spec,
    outcomes,
    usableByPerson,
    normalizedById,
    opportunities,
    bucketMeans,
    globalMean,
    snapshot,
    droppedKinds,
  };
}

/** E[R | O] for an opportunity count under the cohort's bucket means. */
export function expectedForCount(cohort: OutcomeCohort, opportunityCount: number): number {
  const b = cohort.bucketMeans.get(
    opportunityBucket(opportunityCount, cohort.spec.opportunityBuckets),
  );
  return b && b.size >= cohort.spec.minBucketSize ? b.mean : cohort.globalMean;
}

/**
 * Person-level residual truth for everyone with at least one usable outcome
 * observed at or before `now`. Reporting view; not what judges are scored on.
 */
export function residualOutcomes(
  outcomes: readonly Outcome[],
  opportunities: readonly Opportunity[],
  spec: JudgeReliabilitySpec,
  now: Date,
): Map<string, ResidualOutcome> {
  return buildOutcomeCohort(outcomes, opportunities, spec, now).snapshot;
}

/**
 * First instant a causal label for `personId` could exist after `referredAt`:
 * the earliest post-referral outcome whose kind has `minKindSize` observations
 * (counting only outcomes after the referral and ≤ `now`). Null when none.
 */
export function firstCausalEligibleAt(
  outcomes: readonly Outcome[],
  personId: string,
  referredAt: Date,
  spec: JudgeReliabilitySpec,
  now: Date,
): Date | null {
  const nowMs = now.getTime();
  const afterMs = referredAt.getTime();
  const measurable = outcomes.filter((o) => {
    if (o.value === null || !Number.isFinite(o.value)) return false;
    const t = o.observedAt.getTime();
    return t <= nowMs && t > afterMs;
  });
  const byKind = new Map<string, Outcome[]>();
  for (const o of measurable) {
    const list = byKind.get(o.kind);
    if (list) list.push(o);
    else byKind.set(o.kind, [o]);
  }
  const kindEligibleMs = new Map<string, number>();
  for (const [kind, list] of byKind) {
    if (list.length < spec.minKindSize) continue;
    const ordered = [...list].sort(
      (a, b) =>
        a.observedAt.getTime() - b.observedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    kindEligibleMs.set(kind, ordered[spec.minKindSize - 1]!.observedAt.getTime());
  }
  let first: number | null = null;
  for (const o of measurable) {
    if (o.personId !== personId) continue;
    const kindAt = kindEligibleMs.get(o.kind);
    if (kindAt === undefined) continue;
    const eligible = Math.max(o.observedAt.getTime(), kindAt);
    if (first === null || eligible < first) first = eligible;
  }
  return first === null ? null : new Date(first);
}

/**
 * The label for a referral made at `referredAt` about `personId`, or null when
 * the candidate has no outcome observed after the referral (and ≤ T) whose
 * kind is large enough to rank.
 *
 * Rebuilds a causal cohort at the referral cutoff: kind ranks, E[R|O] buckets,
 * and residual percentiles all use the same post-referral observations and
 * (by default) the same opportunity clock. The 180-day gate is applied by
 * the scorer on `T − t_uv`, not on the outcome's own age.
 */
export function labelForPrediction(
  cohort: OutcomeCohort,
  personId: string,
  referredAt: Date,
): PredictionLabel | null {
  const spec = cohort.spec;
  const clock: ResidualClock =
    spec.opportunityClock === "referral"
      ? { after: referredAt, opportunityAsOf: referredAt }
      : { after: referredAt };
  const causal = buildOutcomeCohort(cohort.outcomes, cohort.opportunities, spec, cohort.now, clock);
  const snap = causal.snapshot.get(personId);
  const list = causal.usableByPerson.get(personId);
  if (!snap || !list || list.length === 0) return null;

  const times = list.map((o) => o.observedAt.getTime());
  const firstEligibleAt = firstCausalEligibleAt(
    cohort.outcomes,
    personId,
    referredAt,
    spec,
    cohort.now,
  );
  if (firstEligibleAt === null) return null;
  return {
    personId,
    normalized: snap.normalized,
    opportunityCount: snap.opportunityCount,
    expected: snap.expected,
    residual: snap.residual,
    truth: snap.truth,
    outcomeIds: snap.outcomeIds,
    firstObservedAt: new Date(Math.min(...times)),
    firstEligibleAt,
    latestObservedAt: snap.latestObservedAt,
  };
}
