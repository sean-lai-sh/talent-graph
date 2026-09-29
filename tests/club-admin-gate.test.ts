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
const MEMBER_QUERIES = ["getMyRole", "listPosts", "listMembers", "listMyFeedback"] as const;

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

const MEMBER_MUTATIONS = ["addPost", "respondToFeedback"] as const;

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
  const next = rest.search(/\nexport /);
  return next < 0 ? rest : rest.slice(0, next);
}

function exportedFunction(source: string, name: string): string {
  const marker = `export async function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing function ${name}`);
  const rest = source.slice(start + marker.length);
  const next = rest.search(/\nexport /);
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
    for (const name of MEMBER_MUTATIONS) {
      const body = handler(club, name, "mutation");
      expect(body).not.toContain("requireAdmin");
      expect(body).toContain("getAuthUser");
    }
    expect(handler(club, "respondToFeedback", "mutation")).toContain("prepareMemberResponse");
    expect(handler(club, "listMyFeedback", "query")).toContain("listOwnFeedbackRequests");
    expect(club).toContain('throw new Error("admin only")');
    expect(names(auth, "query")).toEqual(["getCurrentUser"]);
    expect(names(auth, "mutation")).toEqual(["provisionUser"]);
    expect(auth).toContain("ADMIN_PROVISION_SECRET");
  });
});

/**
 * The candidate is not a club account. `referralStatus` takes a token,
 * looks up its hash, and returns one status line. It is not member-open
 * and not admin-only.
 */
const PUBLIC_TOKEN_QUERIES = ["referralStatus"] as const;

const MEMBER_OPEN_QUERIES = ["lookupReferralContact"] as const;

const MEMBER_OPEN_MUTATIONS = [
  "generateResumeUploadUrl",
  "registerResumeUpload",
  "submitReferralSignup",
  "saveMemberReferralAnswers",
] as const;

describe("referral signup access", () => {
  test("every referral function is member-open or public-token", () => {
    const referral = read("apps/club/convex/referral.ts");
    expect(new Set(names(referral, "query"))).toEqual(
      new Set([...MEMBER_OPEN_QUERIES, ...PUBLIC_TOKEN_QUERIES]),
    );
    expect(new Set(names(referral, "mutation"))).toEqual(new Set(MEMBER_OPEN_MUTATIONS));
    expect(referral).not.toMatch(/= (action|httpAction|internal\w+)\(/);

    for (const name of MEMBER_OPEN_QUERIES) {
      const body = handler(referral, name, "query");
      expect(body).toContain("safeGetAuthUser");
      expect(body).not.toContain("loadOrgForSession");
      expect(body).not.toContain("personId");
      expect(body).not.toContain("referrerUserId");
    }
    for (const name of MEMBER_OPEN_MUTATIONS) {
      const body = handler(referral, name, "mutation");
      expect(body).toContain("getAuthUser");
      expect(body).not.toContain("requireAdmin");
      expect(body).not.toContain("applyEngine");
    }
    expect(handler(referral, "generateResumeUploadUrl", "mutation")).toContain("uploadUrlAllowed(");
    expect(handler(referral, "registerResumeUpload", "mutation")).toContain("deleteIfNotResume(");
    const submit = handler(referral, "submitReferralSignup", "mutation");
    expect(submit).toContain("resumeClaimError(upload, user._id)");
    expect(submit).toContain("deleteIfNotResume(");
    expect(submit).toContain("const club = await loadClub(ctx.db)");
    expect(submit).not.toMatch(/for \(const \w+ of/);
    const answers = handler(referral, "saveMemberReferralAnswers", "mutation");
    expect(answers).toContain("const club = await loadClub(ctx.db)");
    expect(answers).toContain("saveOwnedMemberReferral(ctx, club, {");
    const save = exportedFunction(referral, "saveOwnedMemberReferral");
    expect(save).toContain("const before = await loadState(ctx.db, club)");
    expect(save).toContain("await saveState(ctx.db, club, before, result.state)");
    expect(save).toContain("await insertMemberReferralLink(ctx.db, club._id, {");
    expect(exportedFunction(referral, "insertMemberReferralLink")).toContain(
      'db.insert("memberReferrals", { clubId, ...link })',
    );
    for (const body of [answers, save]) {
      expect(body).not.toContain('insert("clubReferrals"');
      expect(body).not.toContain(".patch(");
      expect(body).not.toMatch(/for \(const \w+ of/);
    }
    expect(referral).not.toContain("ORG_SCAN");
    const status = handler(referral, "referralStatus", "query");
    expect(status).toContain("token: v.string()");
    expect(status).toContain("hashStatusToken");
    expect(status).toContain('withIndex("by_token_hash"');
    expect(status).toContain("statusLine(row.createdAt)");
    expect(status).not.toContain("normalizedContact");
    expect(status).not.toContain("getAuthUser");
    expect(status).not.toContain("safeGetAuthUser");
    expect(status).not.toContain("requireAdmin");
    expect(status).not.toContain("personId");
    expect(status).not.toContain("referrerUserId");
    expect(status).not.toContain("email");
    expect(status).not.toContain("contact:");
  });
});
