/**
 * Referral percentile — the rank of S_v among people who have at least one
 * incoming referral. Needed only for the under-recognition diagnostic.
 *
 * People with zero referrals get `null`: missing evidence ≠ low.
 */

import { rankPercentiles } from "../domain/rank.ts";
import type { ReferralSignalResult } from "./referralSignal.ts";

export function referralPercentiles(
  signals: ReadonlyMap<string, ReferralSignalResult>,
): Map<string, number | null> {
  const eligible: Array<{ id: string; value: number }> = [];
  for (const [id, r] of signals) {
    if (r.incomingCount >= 1) eligible.push({ id, value: r.s });
  }
  const pct = rankPercentiles(eligible);
  const out = new Map<string, number | null>();
  for (const id of signals.keys()) out.set(id, pct.get(id) ?? null);
  return out;
}
