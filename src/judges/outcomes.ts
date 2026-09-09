/**
 * Longitudinal outcomes → opportunity-corrected residual labels.
 *
 * From the white paper ("Longitudinal Observation"):
 *
 *   R_v      realised outcome, rank-normalised within its kind (units are free)
 *   R*_v   = R_v − E[R_v | O_v]                 residual after opportunity
 *   truth_v = rank percentile of R*_v / 100     ∈ [0, 1], comparable to x_uv
 *
 * Two views share one cohort built at time T:
 *
 * - `residualOutcomes` — a person-level snapshot for reporting: every usable
 *   outcome the person has, opportunities on the latest-outcome clock.
 * - `labelForPrediction` — the label a single referral u → v is scored
 *   against. Only outcomes observed at least `observationWindowDays` after
 *   the referral count (the paper's "after a fixed observation period");
 *   the opportunity count is taken on the referral clock by default, so an
 *   opportunity the referral itself caused is not subtracted from the
 *   judge's credit. Pre-referral track record never enters E_uv.
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

const DAY = 86_400_000;

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
  /** Mean normalised value over the post-window outcomes only. */
  normalized: number;
  /** Opportunities counted on the spec's clock (referral by default). */
  opportunityCount: number;
  expected: number;
  residual: number;
  /** Rank percentile of the residual within the cohort, divided by 100. */
  truth: number;
  outcomeIds: string[];
  firstObservedAt: Date;
  latestObservedAt: Date;
}

/** Cohort statistics at time T, shared by the snapshot and by per-prediction labels. */
export interface OutcomeCohort {
  now: Date;
  spec: JudgeReliabilitySpec;
  /** Usable outcomes (measurable, ≤ now, kind large enough) per person. */
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

/** Build the cohort at `now`. */
export function buildOutcomeCohort(
  outcomes: readonly Outcome[],
  opportunities: readonly Opportunity[],
  spec: JudgeReliabilitySpec,
  now: Date,
): OutcomeCohort {
  const nowMs = now.getTime();
  const measurable = outcomes.filter(
    (o) => o.value !== null && Number.isFinite(o.value) && o.observedAt.getTime() <= nowMs,
  );

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
      opportunityCount: countOpportunities(opportunities, personId, latest),
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
 * The label for a referral made at `referredAt` about `personId`, or null when
 * no outcome has yet been observed at least `observationWindowDays` after it.
 *
 * Only post-window outcomes enter the label. The opportunity count is taken
 * at the referral (`opportunityClock: "referral"`) or at the latest
 * contributing outcome (`"outcome"`). The percentile is taken against the
 * rest of the cohort's snapshot residuals, so a label equal to the person's
 * own snapshot residual receives exactly the snapshot truth.
 */
export function labelForPrediction(
  cohort: OutcomeCohort,
  personId: string,
  referredAt: Date,
): PredictionLabel | null {
  const spec = cohort.spec;
  const earliest = referredAt.getTime() + spec.observationWindowDays * DAY;
  const qualifying = (cohort.usableByPerson.get(personId) ?? []).filter(
    (o) => o.observedAt.getTime() >= earliest,
  );
  if (qualifying.length === 0) return null;

  const times = qualifying.map((o) => o.observedAt.getTime());
  const latest = Math.max(...times);
  const clockMs = spec.opportunityClock === "referral" ? referredAt.getTime() : latest;
  const opportunityCount = countOpportunities(cohort.opportunities, personId, clockMs);
  const normalized = mean(qualifying.map((o) => cohort.normalizedById.get(o.id) as number));
  const expected = expectedForCount(cohort, opportunityCount);
  const residual = normalized - expected;
  const others: number[] = [];
  for (const [id, s] of cohort.snapshot) if (id !== personId) others.push(s.residual);

  return {
    personId,
    normalized,
    opportunityCount,
    expected,
    residual,
    truth: percentileAmong(others, residual),
    outcomeIds: qualifying.map((o) => o.id).sort(),
    firstObservedAt: new Date(Math.min(...times)),
    latestObservedAt: new Date(latest),
  };
}
