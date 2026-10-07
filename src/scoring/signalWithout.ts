import type { Referral } from "../domain/types.ts";
import {
  computeReferralSignal,
  displayReferralSignal,
  type ReferralSignalOptions,
} from "./referralSignal.ts";

export interface SignalWithout {
  referrerId: string;
  signalWithout: number;
}

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
