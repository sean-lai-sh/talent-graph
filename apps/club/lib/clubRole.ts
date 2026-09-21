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
