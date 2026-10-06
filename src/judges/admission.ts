import type { Referral } from "../domain/types.ts";
import type { AdmissionSpec } from "../models/spec.ts";

export type Channel = "inbound" | "outbound";

export const DEFAULT_CHANNEL: Channel = "inbound";

/** How a referral row came in. A row without one predates the field and is a "referral". */
export type ReferralOrigin = "referral" | "interview";

export const DEFAULT_ORIGIN: ReferralOrigin = "referral";

/**
 * Which referrals may take a position, by the candidate's channel. An outbound
 * candidate was sourced by the club, so only an interviewer's yes ranks there.
 */
export const ELIGIBLE_ORIGINS: Record<Channel, readonly ReferralOrigin[]> = {
  inbound: ["referral", "interview"],
  outbound: ["interview"],
};

export interface CouncilDecision {
  candidateId: string;
  outcome: "admitted" | "denied";
  at: Date;
  decidedBy?: string;
  unresolvedDecider?: { adminReferrers: readonly string[] };
  signal: number | null;
  signalWithout?: readonly { referrerId: string; signalWithout: number }[];
}

export interface AdmissionObservations {
  decisions: readonly CouncilDecision[];
  channels: ReadonlyMap<string, Channel>;
  /** Referral id to origin; a missing id is DEFAULT_ORIGIN. */
  origins: ReadonlyMap<string, ReferralOrigin>;
}

export type Eligibility = Pick<AdmissionObservations, "channels" | "origins">;

export interface ReferralPosition {
  referralId: string;
  judgeId: string;
  candidateId: string;
  position: number;
  share: number;
}

export interface AdmissionTerm {
  referralId: string;
  judgeId: string;
  candidateId: string;
  decision: "admitted" | "denied";
  share: number;
  sign: number;
  reliance: number;
  credit: number;
}

export interface AdmissionResult {
  positions: Map<string, ReferralPosition>;
  terms: AdmissionTerm[];
  sumByJudge: Map<string, number>;
  admitRate: Record<Channel, number>;
}

const byTimeThenId = (a: Referral, b: Referral): number =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function positionShare(
  k: number,
  spec: Pick<AdmissionSpec, "positionExponent" | "positionFloor">,
): number {
  return Math.max(spec.positionFloor, 1 / k ** spec.positionExponent);
}

export function isEligible(r: Referral, eligibility: Eligibility): boolean {
  const channel = eligibility.channels.get(r.candidateId) ?? DEFAULT_CHANNEL;
  return ELIGIBLE_ORIGINS[channel].includes(eligibility.origins.get(r.id) ?? DEFAULT_ORIGIN);
}

export function referralPositions(
  referrals: readonly Referral[],
  eligibility: Eligibility,
  spec: Pick<AdmissionSpec, "positionExponent" | "positionFloor">,
): Map<string, ReferralPosition> {
  const byCandidate = new Map<string, Referral[]>();
  for (const r of [...referrals].sort(byTimeThenId)) {
    if (r.referrerId === r.candidateId) continue;
    if (!isEligible(r, eligibility)) continue;
    const list = byCandidate.get(r.candidateId) ?? [];
    if (list.some((o) => o.referrerId === r.referrerId)) continue;
    list.push(r);
    byCandidate.set(r.candidateId, list);
  }
  const out = new Map<string, ReferralPosition>();
  for (const [candidateId, list] of byCandidate) {
    let i = 0;
    while (i < list.length) {
      let j = i;
      const t = (list[i] as Referral).createdAt.getTime();
      while (j < list.length && (list[j] as Referral).createdAt.getTime() === t) j++;
      const ranks = Array.from({ length: j - i }, (_, n) => i + n + 1);
      const position = ranks.reduce((s, k) => s + k, 0) / ranks.length;
      const share = ranks.reduce((s, k) => s + positionShare(k, spec), 0) / ranks.length;
      for (let n = i; n < j; n++) {
        const r = list[n] as Referral;
        out.set(r.id, { referralId: r.id, judgeId: r.referrerId, candidateId, position, share });
      }
      i = j;
    }
  }
  return out;
}

export function firstDecisions(
  decisions: readonly CouncilDecision[],
  now: Date,
): Map<string, CouncilDecision> {
  const out = new Map<string, CouncilDecision>();
  const live = decisions.filter((d) => d.at.getTime() <= now.getTime());
  for (const d of [...live].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (!out.has(d.candidateId)) out.set(d.candidateId, d);
  }
  return out;
}

export function channelAdmitRates(
  first: ReadonlyMap<string, CouncilDecision>,
  channels: ReadonlyMap<string, Channel>,
  spec: Pick<AdmissionSpec, "priorAdmitRate" | "priorAdmitWeight">,
): Record<Channel, number> {
  const count = { inbound: { admitted: 0, total: 0 }, outbound: { admitted: 0, total: 0 } };
  for (const d of first.values()) {
    const c = count[channels.get(d.candidateId) ?? DEFAULT_CHANNEL];
    c.total++;
    if (d.outcome === "admitted") c.admitted++;
  }
  const rate = (c: { admitted: number; total: number }) =>
    (c.admitted + spec.priorAdmitRate * spec.priorAdmitWeight) / (c.total + spec.priorAdmitWeight);
  return { inbound: rate(count.inbound), outbound: rate(count.outbound) };
}

export function admissionSign(outcome: "admitted" | "denied", admitRate: number): number {
  return outcome === "admitted" ? 1 : -admitRate / (1 - admitRate);
}

export function relianceOn(signal: number, signalWithout: number): number {
  if (!(signal > 0)) return 0;
  return Math.min(1, Math.max(0, (signal - signalWithout) / signal));
}

export function computeAdmission(
  referrals: readonly Referral[],
  observations: AdmissionObservations,
  spec: AdmissionSpec,
  now: Date,
): AdmissionResult {
  const positions = referralPositions(referrals, observations, spec);
  const first = firstDecisions(observations.decisions, now);
  const admitRate = channelAdmitRates(first, observations.channels, spec);
  const terms: AdmissionTerm[] = [];
  const sumByJudge = new Map<string, number>();
  for (const r of [...referrals].sort(byTimeThenId)) {
    const pos = positions.get(r.id);
    const d = first.get(r.candidateId);
    if (pos === undefined || d === undefined) continue;
    if (r.createdAt.getTime() > d.at.getTime()) continue;
    if (d.decidedBy === r.referrerId) continue;
    if (d.unresolvedDecider?.adminReferrers.includes(r.referrerId)) continue;
    if (d.signalWithout === undefined) continue;
    let reliance = 0;
    if (d.outcome === "admitted") {
      const without = d.signalWithout.find((x) => x.referrerId === r.referrerId);
      if (without === undefined || d.signal === null) continue;
      reliance = relianceOn(d.signal, without.signalWithout);
    }
    // Admission credit for a referral without a Jev starting snapshot waits for
    // step 4 (Jev-snapshot gating), which does not exist yet; until then credit
    // applies once the first council decision stands.
    const rate = admitRate[observations.channels.get(r.candidateId) ?? DEFAULT_CHANNEL];
    const sign = admissionSign(d.outcome, rate);
    const credit = Math.min(
      spec.limit,
      Math.max(-spec.limit, spec.kappa * pos.share * sign * (1 - reliance)),
    );
    terms.push({
      referralId: r.id,
      judgeId: r.referrerId,
      candidateId: r.candidateId,
      decision: d.outcome,
      share: pos.share,
      sign,
      reliance,
      credit,
    });
    sumByJudge.set(r.referrerId, (sumByJudge.get(r.referrerId) ?? 0) + credit);
  }
  return { positions, terms, sumByJudge, admitRate };
}
