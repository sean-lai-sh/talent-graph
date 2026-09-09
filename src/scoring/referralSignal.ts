/**
 * Referral Signal S_v — the only V0 score.
 *
 *   p_u   = 1 for every referrer (judge reliability is not learned in V0/V1)
 *   TopK(v) = up to K incoming referrals with the largest R_uv
 *             (ties: earlier createdAt first, then id)
 *   S_v   = |TopK(v)| > 0 ? mean(R_uv, u ∈ TopK(v)) : 0
 *   ReferralSignal_v = 100 · S_v      // float; rounded only for display
 *
 * V2/V3 hook (judge calibration): a caller may pass per-judge reliability
 * p̂_u, bias b̂_u, and optional scout-weight maps. Each referral's
 * contribution becomes
 *
 *   x*_uv = clip(R_uv − b̂_u, 0, 1)
 *   scoutFactor = clip01(scoutWeights.get(u) ?? 1)
 *   contribution = scoutFactor · p̂_u · x*_uv
 *
 * Omitted scoutWeights, or a missing judge in the map, is factor 1 (no Ĝ ⇒
 * do not move the graph). With no maps (or p̂_u = 1, b̂_u = 0, scoutFactor
 * = 1) this is exactly R_uv, so V0 is reproduced bit-for-bit. This module
 * never computes p̂_u or Ĝ_u itself; see src/judges/. Inputs are referrals
 * plus optional judge weights. Rubric evaluations, comparisons, affiliation
 * and bio are not parameters.
 */

import { FIRSTHAND_EVIDENCE_TYPES } from "../domain/constants.ts";
import type { EvidenceType, Person, Referral } from "../domain/types.ts";
import { CURRENT_SPECS } from "../models/registry.ts";
import { assertSpec, type ReferralSignalSpec } from "../models/spec.ts";
import { type ReferralStrengthBreakdown, referralStrengthBreakdown } from "./referralStrength.ts";

export const REFERRAL_SIGNAL_EXPLANATION =
  "Referral Signal summarizes the current strength of referral evidence. It is not an objective measure of ability.";

export interface ContributingReferral {
  referral: Referral;
  /** R_uv */
  strength: number;
  /**
   * Every intermediate of R_uv under the spec that produced this result, so
   * explanations never have to re-derive it with a possibly different spec.
   * `breakdown.strength` is the unweighted R_uv; `strength` above is the
   * judge-weighted contribution (identical when no judge weights are given).
   */
  breakdown: ReferralStrengthBreakdown;
  /** Judge weighting applied to this referral (1 / 0 / R_uv when none). */
  judge: { reliability: number; bias: number; scout: number; adjusted: number };
}

export interface ReferralSignalResult {
  personId: string;
  /** 100 · S_v, unrounded. */
  signal: number;
  /** S_v ∈ [0, 1]. */
  s: number;
  /** TopK, sorted by strength descending. */
  contributing: ContributingReferral[];
  incomingCount: number;
  /** |TopK| */
  usedCount: number;
  /** Incoming referrals whose evidence is firsthand (work or personal). */
  firsthandCount: number;
  /** max R_uv over all incoming (unweighted, even under V2 weights), or null when none. */
  strongest: number | null;
  /** Distinct evidence types among all incoming, in canonical order of first appearance. */
  evidenceTypes: EvidenceType[];
  explanation: string;
  /** Spec that produced the number, for provenance. */
  specVersion: string;
  /**
   * True when any of reliability / bias / scoutWeights was passed.
   * Omitted maps still leave every factor at the identity (1 / 0 / 1).
   */
  judgeWeighted: boolean;
  /** True when a `scoutWeights` map was passed (even if every factor is 1). */
  scoutWeighted: boolean;
}

export interface ReferralSignalOptions {
  spec?: ReferralSignalSpec;
  /** Overrides `spec.topK`. Prefer passing a spec. */
  topK?: number;
  /** p̂_u per judge id from V2 calibration; missing judges count as 1. */
  judgeReliability?: ReadonlyMap<string, number>;
  /** b̂_u per judge id from V2 calibration; missing judges count as 0. */
  judgeBias?: ReadonlyMap<string, number>;
  /**
   * Scout factor per judge id (clipped Ĝ_u when the caller opts in).
   * Omitted map, or a missing judge, is factor 1. Present values are
   * clamped to [0, 1]; non-finite values are rejected.
   */
  scoutWeights?: ReadonlyMap<string, number>;
}

function clip01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Missing map / missing judge ⇒ 1. Present finite values are clipped to [0, 1]. */
function scoutFactorOf(judgeId: string, weights: ReadonlyMap<string, number> | undefined): number {
  if (weights === undefined) return 1;
  const raw = weights.get(judgeId);
  if (raw === undefined) return 1;
  if (!Number.isFinite(raw)) {
    throw new Error(`computeReferralSignal: judge ${judgeId} has scout weight ${raw}`);
  }
  return clip01(raw);
}

function compareContributing(a: ContributingReferral, b: ContributingReferral): number {
  if (b.strength !== a.strength) return b.strength - a.strength;
  const dt = a.referral.createdAt.getTime() - b.referral.createdAt.getTime();
  if (dt !== 0) return dt;
  return a.referral.id < b.referral.id ? -1 : a.referral.id > b.referral.id ? 1 : 0;
}

/** Referral Signal for one person from the referrals that name them as candidate. */
export function computeReferralSignal(
  personId: string,
  referrals: readonly Referral[],
  opts: ReferralSignalOptions = {},
): ReferralSignalResult {
  const spec = assertSpec(opts.spec ?? CURRENT_SPECS.referral_signal);
  const topK = opts.topK ?? spec.topK;

  // Defensive: a self-referral should already be rejected by validateReferral.
  const incoming = referrals.filter((r) => r.candidateId === personId && r.referrerId !== personId);

  const scoutWeighted = opts.scoutWeights !== undefined;
  const judgeWeighted =
    opts.judgeReliability !== undefined || opts.judgeBias !== undefined || scoutWeighted;
  const scored = incoming
    .map((referral): ContributingReferral => {
      const breakdown = referralStrengthBreakdown(referral, spec);
      const reliability = opts.judgeReliability?.get(referral.referrerId) ?? 1;
      const bias = opts.judgeBias?.get(referral.referrerId) ?? 0;
      const scout = scoutFactorOf(referral.referrerId, opts.scoutWeights);
      if (!(reliability >= 0 && reliability <= 1) || !Number.isFinite(bias)) {
        throw new Error(
          `computeReferralSignal: judge ${referral.referrerId} has reliability ${reliability}, bias ${bias}`,
        );
      }
      const adjusted = bias === 0 ? breakdown.strength : clip01(breakdown.strength - bias);
      const strength = reliability === 1 && scout === 1 ? adjusted : scout * reliability * adjusted;
      return { referral, strength, breakdown, judge: { reliability, bias, scout, adjusted } };
    })
    .sort(compareContributing);

  // A zero-reliability or zero-scout judge must not occupy a Top-K slot
  // or dilute the mean.
  const eligible = judgeWeighted
    ? scored.filter((c) => c.judge.reliability > 0 && c.judge.scout > 0)
    : scored;
  const contributing = eligible.slice(0, topK);
  const s =
    contributing.length === 0
      ? 0
      : contributing.reduce((acc, c) => acc + c.strength, 0) / contributing.length;

  const evidenceTypes: EvidenceType[] = [];
  for (const { referral } of scored) {
    if (!evidenceTypes.includes(referral.evidenceType)) evidenceTypes.push(referral.evidenceType);
  }

  return {
    personId,
    signal: 100 * s,
    s,
    contributing,
    incomingCount: incoming.length,
    usedCount: contributing.length,
    firsthandCount: incoming.filter((r) => FIRSTHAND_EVIDENCE_TYPES.includes(r.evidenceType))
      .length,
    // Raw max R_uv, independent of judge weighting (the documented contract).
    strongest: scored.length === 0 ? null : Math.max(...scored.map((c) => c.breakdown.strength)),
    evidenceTypes,
    explanation: REFERRAL_SIGNAL_EXPLANATION,
    specVersion: spec.version,
    judgeWeighted,
    scoutWeighted,
  };
}

/** Referral Signal for every person, keyed by person id. */
export function computeAllReferralSignals(
  people: readonly Person[],
  referrals: readonly Referral[],
  opts: ReferralSignalOptions = {},
): Map<string, ReferralSignalResult> {
  const byCandidate = new Map<string, Referral[]>();
  for (const r of referrals) {
    const list = byCandidate.get(r.candidateId);
    if (list) list.push(r);
    else byCandidate.set(r.candidateId, [r]);
  }
  const out = new Map<string, ReferralSignalResult>();
  for (const p of people) {
    out.set(p.id, computeReferralSignal(p.id, byCandidate.get(p.id) ?? [], opts));
  }
  return out;
}

/** Integer 0..100 for display. The only place rounding happens. */
export function displayReferralSignal(r: ReferralSignalResult): number {
  return Math.round(r.signal);
}
