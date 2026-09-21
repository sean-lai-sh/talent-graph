import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clubLoginHref,
  DEFAULT_AFTER_LOGIN,
  LOGIN_PATH,
  SIGN_OUT_HREF,
  safeReturnPath,
} from "../apps/club/lib/loginReturnPath.ts";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("SEA-26 /login door", () => {
  test("safeReturnPath only allows /club and /members paths", () => {
    expect(safeReturnPath(undefined)).toBe("/club");
    expect(safeReturnPath("")).toBe("/club");
    expect(safeReturnPath("/club")).toBe("/club");
    expect(safeReturnPath("/club/settings")).toBe("/club/settings");
    expect(safeReturnPath("/members")).toBe("/members");
    expect(safeReturnPath("/members/inbox")).toBe("/members/inbox");
    expect(safeReturnPath("/demo")).toBe("/club");
    expect(safeReturnPath("/example")).toBe("/club");
    expect(safeReturnPath("/")).toBe("/club");
    expect(safeReturnPath("https://evil.example/club")).toBe("/club");
    expect(safeReturnPath("//evil.example")).toBe("/club");
    expect(safeReturnPath("/\\evil")).toBe("/club");
    expect(safeReturnPath(["/club", "/demo"])).toBe("/club");
    expect(clubLoginHref("/demo")).toBe("/login?next=%2Fclub");
    expect(clubLoginHref("/club")).toBe("/login?next=%2Fclub");
    expect(clubLoginHref("/members")).toBe("/login?next=%2Fmembers");
    expect(DEFAULT_AFTER_LOGIN).toBe("/club");
    expect(LOGIN_PATH).toBe("/login");
    expect(SIGN_OUT_HREF).toBe("/login");
  });

  test("/login is the chips SignInForm with no create-account path", () => {
    const page = read("apps/club/app/login/page.tsx");
    const form = read("apps/club/components/auth/SignInForm.tsx");
    const layout = read("apps/club/app/login/layout.tsx");
    expect(page).toContain("SignInForm");
    expect(page).toContain("safeReturnPath");
    expect(page).toContain("hasClubSession");
    expect(page).toContain("robots: { index: false, follow: false }");
    expect(page).toContain('className="login"');
    expect(page).not.toContain("LoginCard");
    expect(page).not.toContain("Create account");
    expect(page).not.toContain("Club door");
    expect(form).toContain("signIn.email");
    expect(form).toContain("destAfterLogin");
    expect(form).not.toContain("signUp");
    expect(form).not.toContain("Create account");
    expect(layout).toContain("ConvexClientProvider");
  });

  test("unauthenticated /club redirects to /login and sign-out returns there", () => {
    const page = read("apps/club/app/club/page.tsx");
    const shell = read("apps/club/app/club/ClubShell.tsx");
    expect(page).toContain('redirect(clubLoginHref("/club"))');
    expect(page).toContain("hasClubSession");
    expect(page).not.toContain("SignInForm");
    expect(page).not.toContain("loadClub()");
    expect(page).not.toContain("ClubBoard");
    expect(shell).toContain("ClubSignInRedirect");
    expect(shell).toContain('clubLoginHref("/club")');
    expect(shell).toContain("SIGN_OUT_HREF");
    expect(shell).toContain("authClient.signOut");
    expect(shell).toContain("convexConfigured()");
    expect(shell).not.toContain("SignInForm");
    expect(shell).not.toContain("<Field");
    expect(shell).not.toContain("signIn.email");
    expect(shell).not.toContain("loadClub()");
    expect(shell).not.toContain("generateSeed()");
  });

  test("/ and /demo stay auth-free and no middleware appears", () => {
    const home = read("apps/club/app/page.tsx");
    const demo = read("apps/club/app/demo/page.tsx");
    const example = read("apps/club/app/example/page.tsx");
    const info = read("apps/club/app/info/page.tsx");
    expect(home).toContain("LandingPage");
    expect(demo).toContain("loadClub()");
    expect(example).toContain('redirect("/demo")');
    expect(info).toContain("InfoPage");
    for (const source of [home, demo, example, info]) {
      expect(source).not.toContain("auth-server");
      expect(source).not.toContain("isAuthenticated");
      expect(source).not.toContain("Authenticated");
      expect(source).not.toContain("PersistedClub");
      expect(source).not.toContain("LoginCard");
    }
    expect(existsSync(join(root, "apps/club/middleware.ts"))).toBe(false);
    expect(existsSync(join(root, "apps/club/src/middleware.ts"))).toBe(false);
    expect(existsSync(join(root, "middleware.ts"))).toBe(false);
    expect(existsSync(join(root, "apps/club/proxy.ts"))).toBe(false);
    expect(existsSync(join(root, "proxy.ts"))).toBe(false);
  });

  test("docs name /login and sign-out destination /login", () => {
    const rootReadme = read("README.md");
    const clubReadme = read("apps/club/README.md");
    for (const source of [rootReadme, clubReadme]) {
      expect(source).toContain("/login");
      expect(source).toContain("Sign-out from `/club` returns to `/login`");
    }
  });
});
