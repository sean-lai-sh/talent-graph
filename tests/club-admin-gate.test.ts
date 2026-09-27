import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminRead } from "../apps/club/lib/clubRole.ts";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

/** Council queries. A new `query(` in convex/club.ts must be added here. */
const ADMIN_ONLY_QUERIES = ["getOrganization", "getBoard"] as const;

/** Signed-in members may call these. */
const MEMBER_QUERIES = ["getMyRole", "listPosts", "listMembers"] as const;

/** Mutations that must go through requireAdmin. */
const ADMIN_MUTATIONS = [
  "createOrganization",
  "ensureOrganization",
  "addPerson",
  "setStatus",
  "decide",
  "addReferral",
  "requestFeedback",
  "recordFeedback",
  "setReviewConfig",
] as const;

const MEMBER_MUTATIONS = ["addPost"] as const;

function names(source: string, kind: "query" | "mutation"): string[] {
  return [...source.matchAll(new RegExp(`export const (\\w+) = ${kind}\\(`, "g"))].map(
    (match) => match[1] ?? "",
  );
}

function handler(source: string, name: string, kind: "query" | "mutation"): string {
  const marker = `export const ${name} = ${kind}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${kind} ${name}`);
  const rest = source.slice(start + marker.length);
  const next = rest.search(/\nexport const /);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("admin council data is closed to members", () => {
  test("a member account gets nothing back from each admin query", () => {
    const member = { email: "member@example.test", role: "member" as const };
    const admin = { email: "admin@example.test", role: "admin" as const };
    const council = {
      people: [{ id: "p1", name: "Ada Example" }],
      referrals: [{ id: "r1" }],
      feedbackRequests: [{ id: "f1" }],
      config: { requiredDimensions: ["agency"] },
    };

    for (const name of ADMIN_ONLY_QUERIES) {
      expect(adminRead(member.role, { query: name, ...council })).toBeNull();
      expect(adminRead(null, { query: name, ...council })).toBeNull();
      expect(adminRead(admin.role, { query: name, ...council })).toEqual({
        query: name,
        ...council,
      });
    }

    const club = read("apps/club/convex/club.ts");
    expect(new Set(names(club, "query"))).toEqual(
      new Set([...ADMIN_ONLY_QUERIES, ...MEMBER_QUERIES]),
    );
    for (const name of ADMIN_ONLY_QUERIES) {
      const body = handler(club, name, "query");
      expect(body).toContain("loadOrgForSession");
      expect(body).toContain("return null");
    }
    for (const name of MEMBER_QUERIES) {
      expect(handler(club, name, "query")).not.toContain("loadOrgForSession");
    }
    expect(club).toContain("return adminRead(role, org)");
  });

  test("every council mutation still requires an admin", () => {
    const club = read("apps/club/convex/club.ts");
    const auth = read("apps/club/convex/auth.ts");
    expect(new Set(names(club, "mutation"))).toEqual(
      new Set([...ADMIN_MUTATIONS, ...MEMBER_MUTATIONS]),
    );
    for (const name of ADMIN_MUTATIONS) {
      const body = handler(club, name, "mutation");
      expect(body.includes("applyEngine") || body.includes("ensureOrg")).toBe(true);
    }
    expect(handler(club, "addPost", "mutation")).not.toContain("requireAdmin");
    expect(club).toContain('throw new Error("admin only")');
    expect(names(auth, "query")).toEqual(["getCurrentUser"]);
    expect(names(auth, "mutation")).toEqual(["provisionUser"]);
    expect(auth).toContain("ADMIN_PROVISION_SECRET");
  });
});
