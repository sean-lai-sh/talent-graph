import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADMIN_HOME,
  BOOTSTRAP_ADMIN_EMAIL,
  decideClubPage,
  destAfterLogin,
  doorAfterLogin,
  extraAdminEmailsFromEnv,
  isAdminEmail,
  MEMBER_HOME,
  resolveRole,
} from "../apps/club/lib/clubRole.ts";
import { navForRole } from "../apps/club/lib/shellNav.ts";

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

  test("synthetic emails follow the same role rules", () => {
    expect(resolveRole({ email: "member@example.test" })).toBe("member");
    expect(resolveRole({ email: "admin@example.test" })).toBe("member");
    expect(
      resolveRole({
        email: "admin@example.test",
        extraAdminEmails: ["admin@example.test"],
      }),
    ).toBe("admin");
    expect(resolveRole({ email: "admin@example.test", stored: "admin" })).toBe("admin");
    expect(resolveRole({ email: "admin@example.test", stored: "member" })).toBe("member");
    expect(destAfterLogin("/club", resolveRole({ email: "member@example.test" }))).toBe(
      MEMBER_HOME,
    );
    expect(
      destAfterLogin("/club", resolveRole({ email: "admin@example.test", stored: "admin" })),
    ).toBe(ADMIN_HOME);
    expect(
      destAfterLogin("/members", resolveRole({ email: "admin@example.test", stored: "admin" })),
    ).toBe(MEMBER_HOME);
  });

  test("login door sends a known role before the page renders", () => {
    const member = resolveRole({ email: "member@example.test" });
    const admin = resolveRole({ email: "admin@example.test", stored: "admin" });
    expect(doorAfterLogin("/club", member)).toBe("/members");
    expect(doorAfterLogin("/club", admin)).toBe("/club");
    expect(doorAfterLogin("/members", admin)).toBe("/members");
    expect(doorAfterLogin("/club", null)).toBeNull();
    expect(doorAfterLogin("/club")).toBeNull();

    const login = read("apps/club/app/login/page.tsx");
    expect(login.indexOf("redirect(dest)")).toBeLessThan(login.indexOf("<SignInForm"));
    expect(login).toContain("doorAfterLogin");
  });

  test("sidebar items come from the role and keep the member list", () => {
    expect(navForRole("member").map((item) => item.label)).toEqual([
      "Forum",
      "Submit Referral",
      "Member List",
      "Evaluations",
      "Upcoming Events",
    ]);
    expect(navForRole("admin").map((item) => item.label)).toEqual([
      "Council",
      "Forum",
      "Submit Referral",
      "Member List",
      "Evaluations",
      "Upcoming Events",
    ]);
    expect(navForRole("member").some((item) => item.id === "council")).toBe(false);
  });

  test("server /club gate sends a known member away before the council shell", () => {
    expect(decideClubPage({ signedIn: false })).toBe("login");
    expect(decideClubPage({ signedIn: false, role: "admin" })).toBe("login");
    expect(decideClubPage({ signedIn: true, role: "member" })).toBe("members");
    expect(decideClubPage({ signedIn: true, role: "admin" })).toBe("council");
    expect(decideClubPage({ signedIn: true, role: null })).toBe("login");
    expect(decideClubPage({ signedIn: true })).toBe("defer");

    const page = read("apps/club/app/club/page.tsx");
    const session = read("apps/club/lib/clubSession.ts");
    expect(page).toContain("hasClubSession");
    expect(page).toContain("decideClubPage");
    expect(page).toContain("readSessionRole");
    expect(page).toContain("redirect(MEMBER_HOME)");
    expect(page).toContain("<ClubShell />");
    expect(page.indexOf("redirect(MEMBER_HOME)")).toBeLessThan(
      page.indexOf("return <ClubShell />"),
    );
    expect(session).toContain("fetchAuthQuery");
    expect(session).toContain("api.club.getMyRole");
  });

  test("first admin bootstrap is documented for this deployment's club", () => {
    const readme = read("apps/club/README.md");
    expect(readme).toContain("## First admin");
    expect(readme).toContain("ACCOUNT_ROLE");
    expect(readme).toContain("ADMIN_PROVISION_SECRET");
    expect(readme).toContain("BOOTSTRAP_ADMIN_EMAIL");
    expect(readme).toContain("CLUB_ADMIN_EMAILS");
    expect(readme).toContain("A stored row wins");
    expect(readme).toContain("not keyed by `orgId`");
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
    expect(login).toContain("doorAfterLogin");
    expect(login).toContain("readSessionRole");
    expect(form).toContain("destAfterLogin");
    expect(form).toContain("clubLoginHref");
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
