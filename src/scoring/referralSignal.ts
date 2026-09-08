/**
 * Referral Signal S_v — the only V0 score.
 *
 *   p_u   = 1 for every referrer (judge reliability is not learned in V0/V1)
 *   TopK(v) = up to K incoming referrals with the largest R_uv
 *             (ties: earlier createdAt first, then id)
 *   S_v   = |TopK(v)| > 0 ? mean(R_uv, u ∈ TopK(v)) : 0
 *   ReferralSignal_v = 100 · S_v      // float; rounded only for display
 *
 * Inputs are referrals only. Rubric evaluations, comparisons, affiliation and
 * bio are not parameters and cannot influence the result.
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
   */
  breakdown: ReferralStrengthBreakdown;
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
  /** max R_uv over all incoming, or null when there are none. */
  strongest: number | null;
  /** Distinct evidence types among all incoming, in canonical order of first appearance. */
  evidenceTypes: EvidenceType[];
  explanation: string;
  /** Spec that produced the number, for provenance. */
  specVersion: string;
}

export interface ReferralSignalOptions {
  spec?: ReferralSignalSpec;
  /** Overrides `spec.topK`. Prefer passing a spec. */
  topK?: number;
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

  const scored = incoming
    .map((referral) => {
      const breakdown = referralStrengthBreakdown(referral, spec);
      return { referral, strength: breakdown.strength, breakdown };
    })
    .sort(compareContributing);

  const contributing = scored.slice(0, topK);
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
    strongest: scored.length === 0 ? null : (scored[0]?.strength ?? null),
    evidenceTypes,
    explanation: REFERRAL_SIGNAL_EXPLANATION,
    specVersion: spec.version,
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
