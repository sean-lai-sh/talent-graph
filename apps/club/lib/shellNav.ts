import type { ClubRole } from "./clubRole.ts";

export const MEMBER_NAV = [
  { id: "forum", label: "Forum" },
  { id: "referral", label: "Submit Referral" },
  { id: "members", label: "Member List" },
  { id: "evaluations", label: "Evaluations", count: 0 },
  { id: "events", label: "Upcoming Events" },
] as const;

const COUNCIL_NAV = { id: "council", label: "Council" } as const;

export type MemberPane = (typeof MEMBER_NAV)[number]["id"];
export type ShellPane = MemberPane | typeof COUNCIL_NAV.id;

/** Same items for both roles, plus Council for an admin. */
export function navForRole(role: ClubRole) {
  if (role === "admin") return [COUNCIL_NAV, ...MEMBER_NAV];
  return MEMBER_NAV;
}
