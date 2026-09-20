import type { LongitudinalResidualSlope } from "./types.ts";

export interface ScoutHit {
  referralId: string;
  judgeId: string;
  personId: string;
  forecastKind: "unspecified" | "will_compound";
  /** Unweighted V0 recognition before this judge's referral, normalized to [0, 1]. */
  priorRecognition: number;
  slope: LongitudinalResidualSlope;
}

export interface ScoutInformationGain {
  judgeId: string;
  gain: number;
  evaluatedCount: number;
  rawGain: number | null;
}

/** IG = (1 − prior recognition) × positive residual slope. Undefined slopes are skipped. */
export function scoutHitGain(hit: ScoutHit): number | null {
  if (hit.forecastKind !== "will_compound") return null;
  if (hit.slope.state !== "defined" || hit.slope.delta === null) return null;
  const prior = Math.min(1, Math.max(0, hit.priorRecognition));
  return (1 - prior) * Math.max(hit.slope.delta, 0);
}

/** Shrink each scout's mean information gain toward zero by n / (n + λ). */
export function aggregateScoutInformationGain(
  hits: readonly ScoutHit[],
  shrinkage: number,
): Map<string, ScoutInformationGain> {
  if (!Number.isFinite(shrinkage) || shrinkage < 0) {
    throw new Error("shrinkage must be a finite number >= 0");
  }
  const byJudge = new Map<string, number[]>();
  for (const hit of hits) {
    const gain = scoutHitGain(hit);
    if (gain === null) continue;
    const values = byJudge.get(hit.judgeId);
    if (values) values.push(gain);
    else byJudge.set(hit.judgeId, [gain]);
  }

  const result = new Map<string, ScoutInformationGain>();
  for (const [judgeId, values] of byJudge) {
    const rawGain = values.reduce((sum, value) => sum + value, 0) / values.length;
    result.set(judgeId, {
      judgeId,
      gain: (values.length / (values.length + shrinkage)) * rawGain,
      evaluatedCount: values.length,
      rawGain,
    });
  }
  return result;
}
