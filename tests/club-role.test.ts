import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADMIN_HOME,
  BOOTSTRAP_ADMIN_EMAIL,
  destAfterLogin,
  extraAdminEmailsFromEnv,
  isAdminEmail,
  MEMBER_HOME,
  resolveRole,
} from "../apps/club/lib/clubRole.ts";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("admin vs member role", () => {
  test("unmarked accounts are members; stored role wins", () => {
    expect(BOOTSTRAP_ADMIN_EMAIL).toBe("chips@techatnyu.org");
    expect(isAdminEmail("chips@techatnyu.org")).toBe(true);
    expect(isAdminEmail("member@club.edu")).toBe(false);
    expect(isAdminEmail("you@club.edu", ["you@club.edu"])).toBe(true);
    expect(extraAdminEmailsFromEnv("you@club.edu, other@club.edu")).toEqual([
      "you@club.edu",
      "other@club.edu",
    ]);

    expect(resolveRole({ email: "member@club.edu" })).toBe("member");
    expect(resolveRole({ email: "chips@techatnyu.org" })).toBe("admin");
    expect(resolveRole({ email: "you@club.edu", extraAdminEmails: ["you@club.edu"] })).toBe(
      "admin",
    );
    expect(resolveRole({ email: "chips@techatnyu.org", stored: "member" })).toBe("member");
    expect(resolveRole({ email: "member@club.edu", stored: "admin" })).toBe("admin");
  });

  test("non-admins cannot land on /club after login", () => {
    expect(ADMIN_HOME).toBe("/club");
    expect(MEMBER_HOME).toBe("/members");
    expect(destAfterLogin("/club", "admin")).toBe("/club");
    expect(destAfterLogin("/club", "member")).toBe("/members");
    expect(destAfterLogin("/club/settings", "member")).toBe("/members");
    expect(destAfterLogin("/members", "admin")).toBe("/members");
    expect(destAfterLogin("/members", "member")).toBe("/members");
    expect(destAfterLogin("/demo", "member")).toBe("/members");
    expect(destAfterLogin("/demo", "admin")).toBe("/club");
  });

  test("/club bounces unmarked accounts to the member forum", () => {
    const shell = read("apps/club/app/club/ClubShell.tsx");
    const login = read("apps/club/app/login/page.tsx");
    const form = read("apps/club/components/auth/SignInForm.tsx");
    const club = read("apps/club/convex/club.ts");
    const schema = read("apps/club/convex/schema.ts");
    const auth = read("apps/club/convex/auth.ts");
    const provision = read("apps/club/scripts/provision-user.ts");
    expect(shell).toContain("getMyRole");
    expect(shell).toContain("MEMBER_HOME");
    expect(shell).toContain('me.role !== "admin"');
    expect(shell).toContain("<PersistedClub");
    expect(login).toContain("RoleHomeRedirect");
    expect(form).toContain("destAfterLogin");
    expect(form).toContain("getMyRole");
    expect(club).toContain("export const getMyRole");
    expect(club).toContain('query("clubPosts")');
    expect(club).toContain('query("clubAccounts")');
    expect(club).toContain("admin only");
    expect(schema).toContain("clubAccounts");
    expect(schema).toContain("clubPosts");
    expect(auth).toContain("upsertClubAccount");
    expect(auth).toContain('args.role === "member"');
    expect(provision).toContain("ACCOUNT_ROLE");
  });
});
