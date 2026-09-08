/**
 * Referral strength R_uv — the weight of one referral u → v.
 *
 *   n(x)  = (x − 1) / 4                                    x ∈ {1..5}
 *   X_uv  = w_c·n(conviction) + w_f·n(confidence) + w_d·n(relationshipDepth)
 *   R_uv  = X_uv · m_e                                     ∈ [0, 1]
 *
 * Weights and multipliers come from a ReferralSignalSpec, never from
 * constants read inside this module.
 */

import type { Referral, Scale5 } from "../domain/types.ts";
import { CURRENT_SPECS } from "../models/registry.ts";
import type { ReferralSignalSpec } from "../models/spec.ts";

/** n(x) = (x − 1) / 4: maps the 1..5 slider onto [0, 1]. */
export function normalizeScale(x: Scale5): number {
  return (x - 1) / 4;
}

export interface ReferralStrengthBreakdown {
  normalized: { conviction: number; confidence: number; relationshipDepth: number };
  weights: { conviction: number; confidence: number; relationshipDepth: number };
  /** X_uv — the weighted combination before the evidence multiplier. */
  weighted: number;
  /** m_e for this referral's evidence type. */
  multiplier: number;
  /** R_uv = X_uv · m_e. */
  strength: number;
}

/** Every intermediate of R_uv, for explanation UIs. */
export function referralStrengthBreakdown(
  r: Referral,
  spec: ReferralSignalSpec = CURRENT_SPECS.referral_signal,
): ReferralStrengthBreakdown {
  const normalized = {
    conviction: normalizeScale(r.conviction),
    confidence: normalizeScale(r.confidence),
    relationshipDepth: normalizeScale(r.relationshipDepth),
  };
  const { weights } = spec;
  const weighted =
    weights.conviction * normalized.conviction +
    weights.confidence * normalized.confidence +
    weights.relationshipDepth * normalized.relationshipDepth;
  const multiplier = spec.evidenceMultiplier[r.evidenceType];
  return {
    normalized,
    weights: { ...weights },
    weighted,
    multiplier,
    strength: weighted * multiplier,
  };
}

/** R_uv ∈ [0, 1]. */
export function referralStrength(
  r: Referral,
  spec: ReferralSignalSpec = CURRENT_SPECS.referral_signal,
): number {
  return referralStrengthBreakdown(r, spec).strength;
}
