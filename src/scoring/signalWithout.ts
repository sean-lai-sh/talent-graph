/**
 * Leave-one-judge-out: the Referral Signal a candidate would have had without
 * one referrer. The admission term reads it so a judge earns no early credit
 * for an admission their own referral carried (SEA-79, src/judges/admission.ts).
 *
 * Pure. Takes the same options as `computeReferralSignal`, so it can be run
 * under exactly the weighting the council's signal used.
 */

import type { Referral } from "../domain/types.ts";
import {
  computeReferralSignal,
  displayReferralSignal,
  type ReferralSignalOptions,
} from "./referralSignal.ts";

export interface SignalWithout {
  referrerId: string;
  /** Display-rounded (0..100) Referral Signal without this referrer; 0 when no one else referred. */
  signalWithout: number;
}

/** One entry per distinct referrer of `candidateId`, in order of first referral. */
export function signalWithoutEachReferrer(
  candidateId: string,
  referrals: readonly Referral[],
  opts: ReferralSignalOptions = {},
): SignalWithout[] {
  const referrers: string[] = [];
  for (const r of referrals) {
    if (r.candidateId !== candidateId || r.referrerId === candidateId) continue;
    if (!referrers.includes(r.referrerId)) referrers.push(r.referrerId);
  }
  return referrers.map((referrerId) => ({
    referrerId,
    signalWithout: displayReferralSignal(
      computeReferralSignal(
        candidateId,
        referrals.filter((r) => r.referrerId !== referrerId),
        opts,
      ),
    ),
  }));
}
