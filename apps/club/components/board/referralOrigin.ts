import type { ClubReferral, ContributingView, PersonView } from "../../lib/types.ts";

export type ReferralOrigin = "network" | "outside";

export interface IncomingReferralRow {
  referral: ClubReferral;
  referrer: PersonView | undefined;
  origin: ReferralOrigin;
  contributing: ContributingView | undefined;
}

export function isInNetwork(person: PersonView | undefined): boolean {
  if (!person) return false;
  return person.persona || person.status === "member";
}

export function originOfReferrer(person: PersonView | undefined): ReferralOrigin {
  return isInNetwork(person) ? "network" : "outside";
}

export function incomingReferrals(
  personId: string,
  referrals: ClubReferral[],
  people: PersonView[],
  contributing: ContributingView[],
): IncomingReferralRow[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const contrib = new Map(contributing.map((c) => [c.referralId, c]));
  return referrals
    .filter((r) => r.candidateId === personId)
    .map((referral) => {
      const referrer = byId.get(referral.referrerId);
      return {
        referral,
        referrer,
        origin: originOfReferrer(referrer),
        contributing: contrib.get(referral.id),
      };
    });
}

export function splitIncoming(rows: IncomingReferralRow[]): {
  network: IncomingReferralRow[];
  outside: IncomingReferralRow[];
} {
  return {
    network: rows.filter((r) => r.origin === "network"),
    outside: rows.filter((r) => r.origin === "outside"),
  };
}

export function referrerSummary(rows: IncomingReferralRow[]): string {
  if (rows.length === 0) return "No incoming referrals";
  const names = rows.map((r) => r.referrer?.name ?? r.referral.referrerId);
  if (names.length === 1) return names[0] ?? "Unknown";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}
