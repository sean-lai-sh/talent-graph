/**
 * Position and admission credit (judge_reliability@4.1.0, SEA-79).
 *
 * A referral is a bet that the candidate is better than they look. The council
 * answers within weeks, so its first decision on the candidate gives the judge
 * an early credit or debit, before any outcome exists. Pure; nothing here reads
 * a clock or imports `src/inference/`.
 *
 *   share(k) = max(φ, 1/k^α)                    k = the referral's position
 *   a_uv     = +1 if admitted;  −r/(1−r) if denied     r = the channel's admit rate
 *   ρ_uv     = clip((S_v − S_v^{−u}) / S_v, 0, 1) if admitted;  0 if denied
 *   ℓᴬ_uv    = clip(κ_a · share(k_uv) · a_uv · (1 − ρ_uv), −Lᴬ, Lᴬ)
 *
 * Centring on r means a judge whose candidates are admitted at the normal rate
 * earns 0 in expectation: with about 92% denied, an uncentred debit would drag
 * every judge down.
 *
 * The decision that counts is the candidate's first council decision (admit or
 * deny) — the council decides once a semester, so a fixed window after the
 * referral would usually close before any decision exists. A later reopen or
 * reversal never changes it. A referral made after that decision, or by the
 * person who recorded it, earns nothing, and a decision recorded before the
 * leave-one-judge-out signal was kept (`signalWithout` absent) is not scored:
 * what is unknown is not read as low.
 *
 * Positions are derived on every pass from the referrals; nothing is stored.
 * A "maybe" call creates no referral, so it takes no position; a recruiter
 * makes no referral either, so no weight of theirs ever moves.
 */

import type { Referral } from "../domain/types.ts";
import type { AdmissionSpec } from "../models/spec.ts";

export type Channel = "inbound" | "outbound";

/** A candidate with no stored channel is inbound: it is the common route. */
export const DEFAULT_CHANNEL: Channel = "inbound";

/** One council decision on one candidate, as recorded on a decision snapshot. */
export interface CouncilDecision {
  candidateId: string;
  outcome: "admitted" | "denied";
  at: Date;
  /** The person who recorded the decision; they earn nothing from it. */
  decidedBy?: string;
  /** S_v the council saw, on the same scale as `signalWithout`; null when it had none. */
  signal: number | null;
  /**
   * The same signal without each referrer (leave-one-judge-out). Absent on a
   * decision recorded before it was kept.
   */
  signalWithout?: readonly { referrerId: string; signalWithout: number }[];
}

/** What the admission term reads beyond the referrals. */
export interface AdmissionObservations {
  decisions: readonly CouncilDecision[];
  /** Candidate id → channel. A candidate missing here is `DEFAULT_CHANNEL`. */
  channels: ReadonlyMap<string, Channel>;
}

export interface ReferralPosition {
  referralId: string;
  judgeId: string;
  candidateId: string;
  /** k: 1-based rank among the candidate's eligible referrals; ties share the average rank. */
  position: number;
  /** share(k); ties share the average of the shares they span. */
  share: number;
}

export interface AdmissionTerm {
  referralId: string;
  judgeId: string;
  candidateId: string;
  decision: "admitted" | "denied";
  share: number;
  /** a_uv */
  sign: number;
  /** ρ_uv */
  reliance: number;
  /** ℓᴬ_uv */
  credit: number;
}

export interface AdmissionResult {
  positions: Map<string, ReferralPosition>;
  /** Scored terms, in referral order. */
  terms: AdmissionTerm[];
  /** Σ ℓᴬ per judge with at least one term. */
  sumByJudge: Map<string, number>;
  /** r per channel, as used. */
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

/**
 * Rank each candidate's eligible referrals by `createdAt`, earliest first, one
 * per judge. A self-referral or a repeat by the same judge takes no position.
 * Referrals created at the same instant share the average of their ranks'
 * shares, so the order of equal timestamps never decides who is ahead.
 */
export function referralPositions(
  referrals: readonly Referral[],
  spec: Pick<AdmissionSpec, "positionExponent" | "positionFloor">,
): Map<string, ReferralPosition> {
  const byCandidate = new Map<string, Referral[]>();
  for (const r of [...referrals].sort(byTimeThenId)) {
    if (r.referrerId === r.candidateId) continue;
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

/** The first council decision per candidate that exists at `now`. Ties keep input order. */
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

/**
 * Each channel's admit rate: the observed first decisions, with the prior
 * counted as `priorAdmitWeight` decisions at `priorAdmitRate`. With no data
 * this is the prior; as decisions accumulate it converges to the observed
 * rate, and it can never reach 0 or 1, so −r/(1−r) stays finite.
 */
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

/** a_uv: +1 admitted; a denial is −r/(1−r), so admission at rate r nets 0. */
export function admissionSign(outcome: "admitted" | "denied", admitRate: number): number {
  return outcome === "admitted" ? 1 : -admitRate / (1 - admitRate);
}

/** ρ_uv: how much of the signal the council saw was this judge's. 0 for a denial. */
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
  const positions = referralPositions(referrals, spec);
  const first = firstDecisions(observations.decisions, now);
  const admitRate = channelAdmitRates(first, observations.channels, spec);
  const terms: AdmissionTerm[] = [];
  const sumByJudge = new Map<string, number>();
  for (const r of [...referrals].sort(byTimeThenId)) {
    const pos = positions.get(r.id);
    const d = first.get(r.candidateId);
    if (pos === undefined || d === undefined) continue;
    if (r.createdAt.getTime() > d.at.getTime()) continue; // after the decision: position only
    if (d.decidedBy === r.referrerId) continue; // recusal
    if (d.signalWithout === undefined) continue; // recorded before the signal was kept
    let reliance = 0;
    if (d.outcome === "admitted") {
      // A judge missing from the list was not a referrer when the decision was
      // taken, which `createdAt` above has already excluded; fail closed anyway.
      const without = d.signalWithout.find((x) => x.referrerId === r.referrerId);
      if (without === undefined || d.signal === null) continue;
      reliance = relianceOn(d.signal, without.signalWithout);
    }
    // NOTE (SEA-79): admission credit for a referral without a Jev starting
    // snapshot waits for step 4, which does not exist yet. Until then the
    // credit applies as soon as the first council decision stands.
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
