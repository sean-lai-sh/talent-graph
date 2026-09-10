import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexConfigured } from "../apps/club/lib/convexEnv.ts";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("SEA-9 Convex + Better Auth scaffold", () => {
  test("public example routes stay unauthenticated generateSeed", () => {
    const home = read("apps/club/app/page.tsx");
    const example = read("apps/club/app/example/page.tsx");
    const engine = read("apps/club/lib/engine.ts");
    for (const source of [home, example]) {
      expect(source).toContain("loadClub()");
      expect(source).not.toContain("auth-client");
      expect(source).not.toContain("auth-server");
      expect(source).not.toContain("ConvexClientProvider");
      expect(source).not.toContain("@convex-dev/better-auth");
    }
    expect(engine).toContain("generateSeed()");
    expect(engine).not.toContain("convex");
    expect(engine).not.toContain("better-auth");
  });

  test("Better Auth uses the official Convex component, not custom glue", () => {
    const convexConfig = read("apps/club/convex/convex.config.ts");
    const authConfig = read("apps/club/convex/auth.config.ts");
    const auth = read("apps/club/convex/auth.ts");
    const http = read("apps/club/convex/http.ts");
    const client = read("apps/club/lib/auth-client.ts");
    const server = read("apps/club/lib/auth-server.ts");
    const route = read("apps/club/app/api/auth/[...all]/route.ts");
    const layout = read("apps/club/app/club/layout.tsx");
    const provider = read("apps/club/app/club/ConvexClientProvider.tsx");

    expect(convexConfig).toContain("@convex-dev/better-auth/convex.config");
    expect(authConfig).toContain("getAuthConfigProvider");
    expect(auth).toContain("createClient");
    expect(auth).toContain("authComponent.adapter(ctx)");
    expect(auth).toContain('from "@convex-dev/better-auth/plugins"');
    expect(http).toContain("authComponent.registerRoutes(http, createAuth)");
    expect(client).toContain("convexClient()");
    expect(server).toMatch(/convexBetterAuthNextJs\(\{/);
    expect(server).toContain("convexConfigured");
    expect(layout).toContain("convexConfigured");
    expect(provider).toContain("convexConfigured");
    expect(route).toContain("export const { GET, POST } = handler");
    expect(layout).toContain("ConvexClientProvider");
    expect(provider).toContain("ConvexBetterAuthProvider");
  });

  test("club Convex module stores inputs and imports engine compute", () => {
    const schema = read("apps/club/convex/schema.ts");
    const club = read("apps/club/convex/club.ts");
    expect(schema).toContain("defineSchema");
    expect(schema).toContain("people");
    expect(schema).toContain("referrals");
    expect(schema).toContain("snapshots");
    expect(schema).not.toContain("bradleyTerry");
    expect(schema).not.toContain("computeAllReferralSignals");
    expect(schema).not.toContain("referralStrength");
    expect(schema).toContain("Provenance at accept/archive");
    for (const name of [
      "clubPerson",
      "clubReferral",
      "clubComparison",
      "clubEvaluation",
      "clubOutcome",
      "clubOpportunity",
    ]) {
      const start = schema.indexOf(`const ${name}`);
      const next = schema.indexOf("const club", start + 1);
      const block = schema.slice(start, next === -1 ? schema.length : next);
      expect(block.includes("referralSignal"), `${name} must not persist referralSignal`).toBe(
        false,
      );
    }
    const snapshot = schema.slice(
      schema.indexOf("const clubSnapshot"),
      schema.indexOf("export default defineSchema"),
    );
    expect(snapshot).toContain("referralSignal");
    expect(club).toContain('from "../lib/engine.ts"');
    expect(club).toContain("computeView");
    expect(club).toContain("addPerson");
    expect(club).toContain("setStatus");
    expect(club).toContain("addReferral");
    expect(club).toContain("getBoard");
    expect(club).toContain("getOrganization");
    expect(club).toContain("createOrganization");
    expect(club).not.toContain("bradleyTerry");
    expect(club).not.toContain("computeAllReferralSignals");
    expect(club).not.toContain('from "../../../src/scoring');
  });

  test("README path is Convex + Better Auth, not Clerk or Neon", () => {
    const rootReadme = read("README.md");
    const clubReadme = read("apps/club/README.md");
    const clubEnv = read("apps/club/.env.example");
    const rootEnv = read(".env.example");
    const requiredEnv = [
      "BETTER_AUTH_SECRET",
      "SITE_URL",
      "NEXT_PUBLIC_CONVEX_URL",
      "NEXT_PUBLIC_CONVEX_SITE_URL",
      "NEXT_PUBLIC_SITE_URL",
    ];
    for (const source of [rootReadme, clubReadme]) {
      expect(source).toContain("Convex + Better Auth");
      expect(source).toContain("@convex-dev/better-auth");
      expect(source).toContain("not Clerk, not Neon");
      expect(source).toContain("is the path for");
      expect(source).not.toContain("Clerk and Neon come next");
      expect(source).toContain("`/` and `/example`");
      expect(source).toContain("/club");
      expect(source).toContain("npx convex dev");
      expect(source).toContain("vercel project update --root-directory apps/club");
      expect(source).toContain("vercel link");
      for (const name of requiredEnv) {
        expect(source).toContain(name);
      }
    }
    expect(rootReadme).toContain("does not set");
    expect(clubReadme).toContain("does not set it");
    expect(clubReadme).toContain("Include source files outside of the Root Directory");
    expect(rootReadme).toContain("Include source files outside of the Root Directory");
    expect(clubEnv).toContain("/club");
    expect(clubEnv).toContain("Do not set these");
    expect(clubEnv).toContain("@convex-dev/better-auth");
    expect(clubEnv).toContain("Not Clerk, not Neon");
    expect(rootEnv).toContain("Do not add");
    for (const name of requiredEnv) {
      expect(clubEnv).toContain(name);
      expect(rootEnv).toContain(name);
    }
  });

  test("Convex env predicate is one helper and rejects .convex.cloud site URLs", () => {
    expect(convexConfigured("https://x.convex.cloud", "https://x.convex.site")).toBe(true);
    expect(convexConfigured("https://x.convex.cloud", "https://x.convex.cloud")).toBe(false);
    expect(convexConfigured("", "https://x.convex.site")).toBe(false);
    const shell = read("apps/club/app/club/ClubShell.tsx");
    expect(shell).toContain("convexConfigured()");
    expect(shell).not.toContain("Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)");
  });
});
