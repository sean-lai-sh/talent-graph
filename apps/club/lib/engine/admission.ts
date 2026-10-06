/**
 * What the council's decisions and the candidates' channels give the engine.
 * No arithmetic: the admission term lives in `src/judges/admission.ts`.
 */

import type {
  AdmissionObservations,
  Channel,
  CouncilDecision,
} from "../../../../src/judges/admission.ts";
import type { ClubState } from "../types.ts";

/**
 * Admit and deny snapshots, as council decisions. Snapshots of any other
 * decision (a reopen, a request for data, a plain status change) are not a
 * council decision, so a reopen after the first decision changes nothing.
 */
export function admissionObservations(state: ClubState): AdmissionObservations {
  const decisions: CouncilDecision[] = [];
  // The club keeps snapshots newest first. `firstDecisions` breaks a tie on
  // `at` by input order, so they are handed over oldest first: two decisions
  // recorded at the same instant resolve to the one recorded first.
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
  return { decisions, channels };
}
