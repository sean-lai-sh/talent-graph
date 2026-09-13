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
  test("safeReturnPath only allows /club paths", () => {
    expect(safeReturnPath(undefined)).toBe("/club");
    expect(safeReturnPath("")).toBe("/club");
    expect(safeReturnPath("/club")).toBe("/club");
    expect(safeReturnPath("/club/settings")).toBe("/club/settings");
    expect(safeReturnPath("/example")).toBe("/club");
    expect(safeReturnPath("/")).toBe("/club");
    expect(safeReturnPath("https://evil.example/club")).toBe("/club");
    expect(safeReturnPath("//evil.example")).toBe("/club");
    expect(safeReturnPath("/\\evil")).toBe("/club");
    expect(safeReturnPath(["/club", "/example"])).toBe("/club");
    expect(clubLoginHref("/example")).toBe("/login?next=%2Fclub");
    expect(clubLoginHref("/club")).toBe("/login?next=%2Fclub");
    expect(DEFAULT_AFTER_LOGIN).toBe("/club");
    expect(LOGIN_PATH).toBe("/login");
    expect(SIGN_OUT_HREF).toBe("/login");
  });

  test("/login is a centered card using shared Field, Input, and Button", () => {
    const page = read("apps/club/app/login/page.tsx");
    const card = read("apps/club/app/login/LoginCard.tsx");
    expect(page).toContain("grid min-h-dvh place-items-center");
    expect(page).toContain("<LoginCard");
    expect(page).not.toContain("Club door");
    expect(page).not.toContain("TALENT GRAPH");
    expect(page).not.toContain("your club");
    expect(page).not.toContain("Convex is not connected");
    expect(card).toContain("<Field");
    expect(card).toContain("<Input");
    expect(card).toContain("<Button");
    expect(card).toContain("Sign in");
    expect(card).toContain("Create account");
    expect(card).toContain('label="Email"');
    expect(card).toContain('label="Password"');
    expect(card).toContain("authClient.signIn.email");
    expect(card).toContain("authClient.signUp.email");
    expect(card).not.toContain("Club door");
    expect(card).not.toContain("Talent Graph");
    expect(card).not.toContain("Convex + Better Auth");
    expect(card).not.toContain("rounded border border-line bg-canvas");
  });

  test("unauthenticated /club redirects to /login and sign-out returns there", () => {
    const page = read("apps/club/app/club/page.tsx");
    const shell = read("apps/club/app/club/ClubShell.tsx");
    expect(page).toContain('redirect(clubLoginHref("/club"))');
    expect(page).toContain("hasClubSession");
    expect(page).not.toContain("ClubSignInForm");
    expect(page).not.toContain("loadClub()");
    expect(page).not.toContain("ClubBoard");
    expect(shell).toContain("RedirectToLogin");
    expect(shell).toContain('clubLoginHref("/club")');
    expect(shell).toContain("SIGN_OUT_HREF");
    expect(shell).toContain("authClient.signOut");
    expect(shell).not.toContain("ClubSignInForm");
    expect(shell).not.toContain("<Field");
    expect(shell).not.toContain("signIn.email");
    expect(shell).not.toContain("loadClub()");
    expect(shell).not.toContain("generateSeed()");
  });

  test("/example and / stay auth-free and no middleware appears", () => {
    const home = read("apps/club/app/page.tsx");
    const example = read("apps/club/app/example/page.tsx");
    expect(home).toContain('redirect("/example")');
    expect(example).toContain("loadClub()");
    for (const source of [home, example]) {
      expect(source).not.toContain("auth-client");
      expect(source).not.toContain("auth-server");
      expect(source).not.toContain("isAuthenticated");
      expect(source).not.toContain("Authenticated");
      expect(source).not.toContain("PersistedClub");
      expect(source).not.toContain("LoginCard");
    }
    expect(existsSync(join(root, "apps/club/middleware.ts"))).toBe(false);
    expect(existsSync(join(root, "apps/club/src/middleware.ts"))).toBe(false);
    expect(existsSync(join(root, "middleware.ts"))).toBe(false);
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
