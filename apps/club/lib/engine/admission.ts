import type {
  AdmissionObservations,
  Channel,
  CouncilDecision,
  ReferralOrigin,
} from "../../../../src/judges/admission.ts";
import type { ClubState } from "../types.ts";

export function admissionObservations(state: ClubState): AdmissionObservations {
  const decisions: CouncilDecision[] = [];
  for (const s of [...state.snapshots].reverse()) {
    if (s.decision !== "admitted" && s.decision !== "denied") continue;
    decisions.push({
      candidateId: s.personId,
      outcome: s.decision,
      at: new Date(s.createdAt),
      signal: s.values.referralSignal,
      ...(s.decidedBy === undefined ? {} : { decidedBy: s.decidedBy }),
      ...(s.unresolvedDecider === undefined
        ? {}
        : { unresolvedDecider: { adminReferrers: [...s.unresolvedDecider.adminReferrers] } }),
      ...(s.signalWithout === undefined
        ? {}
        : { signalWithout: s.signalWithout.map((x) => ({ ...x })) }),
    });
  }
  const channels = new Map<string, Channel>();
  for (const p of state.people) if (p.channel !== undefined) channels.set(p.id, p.channel);
  const origins = new Map<string, ReferralOrigin>();
  for (const r of state.referrals) if (r.origin !== undefined) origins.set(r.id, r.origin);
  return { decisions, channels, origins };
}
