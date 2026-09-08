/**
 * Relative Capability Estimate — per-dimension percentiles within the
 * connected pool, with explicit insufficient-evidence states.
 *
 * Never collapsed to a scalar. Each dimension is fitted independently
 * (toObservations → fitBradleyTerry), percentiles are taken only among
 * members of the same component who are themselves estimated, and a
 * person below the evidence thresholds gets `insufficient_evidence` rather
 * than a low number.
 */

import { DIMENSIONS, PRODUCT_LANGUAGE } from "../domain/constants.ts";
import { ordinal } from "../domain/rank.ts";
import type { Comparison, Dimension, Person } from "../domain/types.ts";
import { CURRENT_SPECS } from "../models/registry.ts";
import type { BradleyTerrySpec } from "../models/spec.ts";
import {
  type BradleyTerryFit,
  type BradleyTerryOptions,
  type BradleyTerryRun,
  fitBradleyTerry,
  thetaMap,
  toObservations,
} from "./bradleyTerry.ts";
import { percentileWithin } from "./percentile.ts";

export const CAPABILITY_EXPLANATION =
  "This estimate is inferred from pairwise comparisons within the observed network and should not be interpreted as an absolute measure of ability.";

export type PoolConfidence = "low" | "medium" | "high";

export type DimensionEstimate =
  | {
      state: "estimated";
      dimension: Dimension;
      theta: number;
      /** Rank percentile among estimated members of the same component. */
      percentile: number;
      comparisonCount: number;
      opponentCount: number;
      wins: number;
      losses: number;
      componentId: string;
      /** Everyone in the connected component, estimated or not. */
      componentSize: number;
      /** Estimated members the percentile is relative to. */
      poolSize: number;
      /** Observations inside the component. */
      poolComparisonCount: number;
      /** Heuristic label on pool size and density; not theory. */
      poolConfidence: PoolConfidence;
      /** ≤5 newest comparisons involving the person on this dimension. */
      recent: Comparison[];
    }
  | {
      state: "insufficient_evidence";
      dimension: Dimension;
      comparisonCount: number;
      opponentCount: number;
      reason: string;
    };

export interface CapabilityVector {
  personId: string;
  dimensions: Record<Dimension, DimensionEstimate>;
  explanation: string;
  specVersion: string;
}

export interface CapabilityRun {
  vectors: Map<string, CapabilityVector>;
  runsByDimension: Record<Dimension, BradleyTerryRun>;
  options: {
    specVersion: string;
    minComparisons: number;
    minOpponents: number;
    tieHandling: "ignore" | "half";
    anchored: boolean;
  };
}

export interface CapabilityOptions {
  spec?: BradleyTerrySpec;
  minComparisons?: number;
  minOpponents?: number;
  tieHandling?: "ignore" | "half";
  /** Solver overrides forwarded to fitBradleyTerry (spec/label/anchor are set here). */
  bt?: Omit<BradleyTerryOptions, "spec" | "label" | "anchor">;
  /**
   * Previous run used as warm start and, when `anchorStrength` (or the spec's
   * `anchorStrength`) is > 0, as the anchor prior. Continuity device, not theory.
   */
  previous?: CapabilityRun;
  anchorStrength?: number;
}

/**
 * Heuristic, not theory: how much to trust a percentile given how big and
 * how densely compared the pool is.
 */
export function poolConfidence(poolSize: number, avgComparisonsPerPerson: number): PoolConfidence {
  if (poolSize >= 15 && avgComparisonsPerPerson >= 6) return "high";
  if (poolSize >= 6 && avgComparisonsPerPerson >= 3) return "medium";
  return "low";
}

function insufficientReason(
  fit: BradleyTerryFit,
  minComparisons: number,
  minOpponents: number,
  poolSize: number,
): string | null {
  const parts: string[] = [];
  if (fit.comparisonCount < minComparisons) {
    parts.push(
      `${fit.comparisonCount} comparison${fit.comparisonCount === 1 ? "" : "s"}; need at least ${minComparisons}`,
    );
  }
  if (fit.opponentCount < minOpponents) {
    parts.push(
      `${fit.opponentCount} unique opponent${fit.opponentCount === 1 ? "" : "s"}; need at least ${minOpponents}`,
    );
  }
  if (parts.length === 0 && poolSize < 2) {
    parts.push("no one else in this pool has enough evidence to rank against");
  }
  return parts.length === 0 ? null : parts.join("; ");
}

/** Fit every dimension and assemble a 7-dimension vector per person. */
export function computeCapabilityVectors(
  people: readonly Person[],
  comparisons: readonly Comparison[],
  opts: CapabilityOptions = {},
): CapabilityRun {
  const spec = opts.spec ?? CURRENT_SPECS.bradley_terry;
  const minComparisons = opts.minComparisons ?? spec.minComparisons;
  const minOpponents = opts.minOpponents ?? spec.minOpponents;
  const tieHandling = opts.tieHandling ?? spec.tieHandling;
  const kappa = opts.anchorStrength ?? spec.anchorStrength;
  const ids = people.map((p) => p.id);

  const runsByDimension = {} as Record<Dimension, BradleyTerryRun>;
  const estimates = new Map<string, Record<Dimension, DimensionEstimate>>(
    ids.map((id) => [id, {} as Record<Dimension, DimensionEstimate>]),
  );

  for (const dimension of DIMENSIONS) {
    const observations = toObservations(comparisons, dimension, { tieHandling });
    const previousRun = opts.previous?.runsByDimension[dimension];
    const btOptions: BradleyTerryOptions = { ...opts.bt, spec, label: dimension };
    if (previousRun) btOptions.anchor = { theta: thetaMap(previousRun), strength: kappa };
    const run = fitBradleyTerry(ids, observations, btOptions);
    runsByDimension[dimension] = run;

    // First pass: who clears the individual thresholds.
    const fitById = new Map(run.fits.map((f) => [f.personId, f]));
    const eligibleByComponent = new Map<string, BradleyTerryFit[]>();
    for (const fit of run.fits) {
      if (fit.comparisonCount >= minComparisons && fit.opponentCount >= minOpponents) {
        const list = eligibleByComponent.get(fit.componentId);
        if (list) list.push(fit);
        else eligibleByComponent.set(fit.componentId, [fit]);
      }
    }

    // Second pass: percentiles within each component's eligible pool.
    const percentileById = new Map<string, number>();
    for (const pool of eligibleByComponent.values()) {
      if (pool.length < 2) continue;
      const ranked = percentileWithin(pool.map((f) => ({ id: f.personId, theta: f.theta })));
      for (const [id, pct] of ranked) percentileById.set(id, pct);
    }

    const componentObs = new Map(run.components.map((c) => [c.componentId, c.comparisonCount]));
    const recentByPerson = recentComparisons(comparisons, dimension, ids);

    for (const id of ids) {
      const fit = fitById.get(id);
      if (!fit) continue;
      const pool = eligibleByComponent.get(fit.componentId) ?? [];
      const reason = insufficientReason(fit, minComparisons, minOpponents, pool.length);
      const row = estimates.get(id) as Record<Dimension, DimensionEstimate>;
      if (reason !== null || !percentileById.has(id)) {
        row[dimension] = {
          state: "insufficient_evidence",
          dimension,
          comparisonCount: fit.comparisonCount,
          opponentCount: fit.opponentCount,
          reason: reason ?? "not rankable within its pool",
        };
        continue;
      }
      const poolComparisonCount = componentObs.get(fit.componentId) ?? 0;
      const avg = pool.reduce((s, f) => s + f.comparisonCount, 0) / pool.length;
      row[dimension] = {
        state: "estimated",
        dimension,
        theta: fit.theta,
        percentile: percentileById.get(id) as number,
        comparisonCount: fit.comparisonCount,
        opponentCount: fit.opponentCount,
        wins: fit.wins,
        losses: fit.losses,
        componentId: fit.componentId,
        componentSize: fit.componentSize,
        poolSize: pool.length,
        poolComparisonCount,
        poolConfidence: poolConfidence(pool.length, avg),
        recent: recentByPerson.get(id) ?? [],
      };
    }
  }

  const vectors = new Map<string, CapabilityVector>();
  for (const id of ids) {
    vectors.set(id, {
      personId: id,
      dimensions: estimates.get(id) as Record<Dimension, DimensionEstimate>,
      explanation: CAPABILITY_EXPLANATION,
      specVersion: spec.version,
    });
  }

  return {
    vectors,
    runsByDimension,
    options: {
      specVersion: spec.version,
      minComparisons,
      minOpponents,
      tieHandling,
      anchored: opts.previous !== undefined,
    },
  };
}

function recentComparisons(
  comparisons: readonly Comparison[],
  dimension: Dimension,
  ids: readonly string[],
): Map<string, Comparison[]> {
  const known = new Set(ids);
  const byPerson = new Map<string, Comparison[]>();
  const sorted = comparisons
    .filter((c) => c.dimension === dimension)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  for (const c of sorted) {
    for (const id of [c.personAId, c.personBId]) {
      if (!known.has(id)) continue;
      const list = byPerson.get(id) ?? [];
      if (list.length < 5) {
        list.push(c);
        byPerson.set(id, list);
      }
    }
  }
  return byPerson;
}

/** Human-readable label for the dimension key. */
export function dimensionLabel(d: Dimension): string {
  const words = d.split("_");
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

/**
 * e.g. "Estimated percentile: 91st · Comparisons: 18 · Unique opponents: 11"
 * or "Insufficient evidence (2 comparisons; need at least 3)".
 */
export function formatDimensionEstimate(e: DimensionEstimate): string {
  if (e.state === "insufficient_evidence") {
    return `${PRODUCT_LANGUAGE.insufficientEvidence} (${e.reason})`;
  }
  return `Estimated percentile: ${ordinal(e.percentile)} · Comparisons: ${e.comparisonCount} · Unique opponents: ${e.opponentCount}`;
}

/** The estimated (person, dimension) pairs of a run, for dashboards and diagnostics. */
export function estimatedEntries(
  run: CapabilityRun,
): Array<{ personId: string; estimate: Extract<DimensionEstimate, { state: "estimated" }> }> {
  const out: Array<{
    personId: string;
    estimate: Extract<DimensionEstimate, { state: "estimated" }>;
  }> = [];
  for (const [personId, vector] of run.vectors) {
    for (const d of DIMENSIONS) {
      const e = vector.dimensions[d];
      if (e.state === "estimated") out.push({ personId, estimate: e });
    }
  }
  return out;
}
