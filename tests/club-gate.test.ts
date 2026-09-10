import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("SEA-12 Better Auth gate on /club", () => {
  test("unauthenticated /club is sign-in UI, never seed or PersistedClub", () => {
    const shell = read("apps/club/app/club/ClubShell.tsx");
    const page = read("apps/club/app/club/page.tsx");
    expect(page).toContain("<ClubShell />");
    expect(page).not.toContain("loadClub()");
    expect(page).not.toContain("ClubBoard");
    expect(shell).toContain('from "convex/react"');
    expect(shell).toContain("Authenticated");
    expect(shell).toContain("Unauthenticated");
    expect(shell).toContain("AuthLoading");
    expect(shell).toContain("ClubSignInForm");
    expect(shell).toContain("<PersistedClub />");
    expect(shell.indexOf("<PersistedClub")).toBeGreaterThan(shell.indexOf("<Authenticated>"));
    expect(shell).toMatch(/<Unauthenticated>\s*<ClubSignInForm/);
    expect(shell).not.toContain("loadClub()");
    expect(shell).not.toContain("generateSeed()");
    expect(shell).not.toContain("configured ? <PersistedClub");
  });

  test("public example routes have no auth wall and no middleware", () => {
    const home = read("apps/club/app/page.tsx");
    const example = read("apps/club/app/example/page.tsx");
    for (const source of [home, example]) {
      expect(source).toContain("loadClub()");
      expect(source).not.toContain("auth-client");
      expect(source).not.toContain("auth-server");
      expect(source).not.toContain("isAuthenticated");
      expect(source).not.toContain("Authenticated");
      expect(source).not.toContain("PersistedClub");
      expect(source).not.toContain("@convex-dev/better-auth");
    }
    expect(existsSync(join(root, "apps/club/middleware.ts"))).toBe(false);
    expect(existsSync(join(root, "apps/club/src/middleware.ts"))).toBe(false);
    expect(existsSync(join(root, "middleware.ts"))).toBe(false);
  });

  test("Convex mutations lock to Better Auth sessions and owner orgs", () => {
    const club = read("apps/club/convex/club.ts");
    const schema = read("apps/club/convex/schema.ts");
    const auth = read("apps/club/convex/auth.ts");
    expect(auth).toContain('from "@convex-dev/better-auth"');
    expect(auth).toContain("authComponent.safeGetAuthUser");
    expect(club).toContain('from "./auth"');
    expect(club).toContain("authComponent.getAuthUser");
    expect(club).toContain("authComponent.safeGetAuthUser");
    expect(club).toContain("ownerUserId");
    expect(club).toContain('withIndex("by_owner"');
    expect(schema).toContain("ownerUserId: v.string()");
    expect(schema).toContain('.index("by_owner", ["ownerUserId"])');
    expect(club).not.toContain('query("clubOrgs").first()');
  });

  test("docs list the /club env vars Sean needs", () => {
    const env = read("apps/club/.env.example");
    const readme = read("apps/club/README.md");
    for (const source of [env, readme]) {
      expect(source).toContain("BETTER_AUTH_SECRET");
      expect(source).toContain("SITE_URL");
      expect(source).toContain("NEXT_PUBLIC_CONVEX_URL");
      expect(source).toContain("NEXT_PUBLIC_CONVEX_SITE_URL");
      expect(source).toContain("NEXT_PUBLIC_SITE_URL");
      expect(source).toContain("npx convex dev");
    }
    expect(env).toContain("Do not set these");
    expect(readme).toContain("npx convex env set BETTER_AUTH_SECRET");
    expect(readme).toContain("/club");
  });
});
