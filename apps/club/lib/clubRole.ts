import { safeReturnPath } from "./loginReturnPath.ts";

export type ClubRole = "admin" | "member";

export const ADMIN_HOME = "/club";
export const MEMBER_HOME = "/members";

/** Test / landing owner. Marked admin when no clubAccounts row exists yet. */
export const BOOTSTRAP_ADMIN_EMAIL = "chips@techatnyu.org";

export function isAdminEmail(email: string, extra: readonly string[] = []): boolean {
  const value = email.trim().toLowerCase();
  if (value === BOOTSTRAP_ADMIN_EMAIL) return true;
  return extra.some((item) => item.trim().toLowerCase() === value);
}

export function extraAdminEmailsFromEnv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Stored role wins. Otherwise only bootstrap / listed emails are admin —
 * everyone else is a member.
 */
export function resolveRole(input: {
  email?: string | null;
  stored?: ClubRole | null;
  extraAdminEmails?: readonly string[];
}): ClubRole {
  if (input.stored === "admin" || input.stored === "member") return input.stored;
  if (input.email && isAdminEmail(input.email, input.extraAdminEmails)) return "admin";
  return "member";
}

export function destAfterLogin(next: string, role: ClubRole): string {
  const safe = safeReturnPath(next);
  if ((safe === ADMIN_HOME || safe.startsWith(`${ADMIN_HOME}/`)) && role !== "admin") {
    return MEMBER_HOME;
  }
  return safe;
}

/**
 * `/login` is the single post-login door. A known role is sent on from
 * here with `destAfterLogin`. Null means the role was not read — the
 * client `RoleHomeRedirect` still runs.
 */
export function doorAfterLogin(next: string, role?: ClubRole | null): string | null {
  if (role !== "admin" && role !== "member") return null;
  return destAfterLogin(next, role);
}

/** Council reads are null unless the role is admin. Same rule as `getBoard`. */
export function adminRead<T>(role: ClubRole | null | undefined, value: T | null): T | null {
  if (role !== "admin") return null;
  return value;
}

export type ClubPageDecision = "login" | "members" | "council" | "defer";

/**
 * Server gate for `/club`. `defer` means the role could not be read, so the
 * page still renders ClubShell and its client redirect. A known non-admin
 * never reaches that shell.
 */
export function decideClubPage(input: {
  signedIn: boolean;
  role?: ClubRole | null;
}): ClubPageDecision {
  if (!input.signedIn) return "login";
  if (input.role === "admin") return "council";
  if (input.role === "member") return "members";
  if (input.role === null) return "login";
  return "defer";
}

export function decidedByPersonId(
  matchIds: readonly string[],
  warn: (line: string) => void = console.warn,
): string | undefined {
  if (matchIds.length === 1) return matchIds[0];
  const found = matchIds.length === 0 ? "no person row" : "more than one person row";
  warn(
    `club decision: no decidedBy recorded, the signed-in admin's email matches ${found}; recusal is skipped for this decision`,
  );
  return undefined;
}

export interface ReferrerAccounts {
  personId: string;
  email?: string;
  storedRoles: readonly ClubRole[];
}

/**
 * Known gap: a referrer is matched by the email on their person row. An admin
 * whose person row has no email, or a different one from their account, is
 * not found here and keeps their admission credit. The fix is that every admin
 * links to exactly one person (follow-up to SEA-79).
 */
export function adminReferrers(
  referrers: readonly ReferrerAccounts[],
  extraAdminEmails: readonly string[] = [],
): string[] {
  const out: string[] = [];
  for (const r of referrers) {
    const email = r.email?.trim().toLowerCase();
    if (!email) continue;
    const stored = r.storedRoles.length === 0 ? [null] : r.storedRoles;
    const admin = stored.some(
      (role) => resolveRole({ email, stored: role, extraAdminEmails }) === "admin",
    );
    if (admin && !out.includes(r.personId)) out.push(r.personId);
  }
  return out;
}
