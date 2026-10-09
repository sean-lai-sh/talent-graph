import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";
import { adminRead, type ClubRole, extraAdminEmailsFromEnv, resolveRole } from "../lib/clubRole.ts";
import { type Club, ensureClub, loadClub, loadState, saveState } from "../lib/clubStore.ts";
import {
  addPerson as addPersonEngine,
  addReferral as addReferralEngine,
  computeView,
  decide as decideEngine,
  recordFeedback as recordFeedbackEngine,
  requestFeedback as requestFeedbackEngine,
  setReviewConfig as setReviewConfigEngine,
  setStatus as setStatusEngine,
} from "../lib/engine.ts";
import { toDirectoryMembers } from "../lib/memberDirectory.ts";
import { listOwnFeedbackRequests, prepareMemberResponse } from "../lib/memberFeedback.ts";
import type { ClubState, EngineResult } from "../lib/types.ts";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import {
  comparisonOutcome,
  dimension,
  evidenceType,
  personStatus,
  rubricScore,
  scale5,
} from "./schema";

/**
 * Persist club *inputs* here. Every write re-runs views via `lib/engine.ts`
 * (`src/` compute). Do not reimplement scoring / inference / judges.
 *
 * SEA-12: writes and board reads require a Better Auth session
 * (`authComponent.getAuthUser` / `safeGetAuthUser`) and a marked admin
 * role. Every admin shares one club, the oldest `clubs` row
 * (`lib/clubStore.ts`). One club per deployment, not a membership / invite model.
 *
 * Clock: the engine never reads a clock. Each mutation stamps `now` with
 * wall time before running so referrals, decisions, and the 48-hour
 * feedback window carry real timestamps; `getBoard` reads at the last write.
 */

type QueryCtx = GenericQueryCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;

const optionalName = v.optional(v.string());
const nullableScale5 = v.union(scale5, v.null());

type AuthUser = { _id: string; email?: string; name?: string };

function extraAdminEmails(): string[] {
  return extraAdminEmailsFromEnv(process.env.CLUB_ADMIN_EMAILS);
}

async function storedRole(ctx: QueryCtx | MutationCtx, userId: string): Promise<ClubRole | null> {
  const account = await ctx.db
    .query("clubAccounts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  return account?.role ?? null;
}

async function roleForUser(ctx: QueryCtx | MutationCtx, user: AuthUser): Promise<ClubRole> {
  return resolveRole({
    email: typeof user.email === "string" ? user.email : "",
    stored: await storedRole(ctx, user._id),
    extraAdminEmails: extraAdminEmails(),
  });
}

/** Board reads: missing session or a non-admin → no org. Mutations throw. */
async function loadOrgForSession(ctx: QueryCtx | MutationCtx): Promise<Club | null> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) return null;
  const role = await roleForUser(ctx, user);
  const org = role === "admin" ? await loadClub(ctx.db) : null;
  return adminRead(role, org);
}

export async function requireAdmin(ctx: MutationCtx): Promise<AuthUser> {
  const user = await authComponent.getAuthUser(ctx);
  if ((await roleForUser(ctx, user)) !== "admin") {
    throw new Error("admin only");
  }
  return user;
}

/**
 * The club, created by the first admin to use it. No view: `applyEngine` is
 * about to run a transition that computes one, and a council click may not pay
 * for two passes of the engine over every observation.
 */
async function ensureOrgDoc(
  ctx: MutationCtx,
  name?: string,
): Promise<{ club: Club; orgId: Id<"clubs">; name: string; state: ClubState }> {
  const user = await requireAdmin(ctx);
  const club = await ensureClub(ctx.db, user._id, name);
  return { club, orgId: club._id, name: club.name, state: await loadState(ctx.db, club) };
}

/** The same, for the mutations whose answer *is* the org and its view. */
async function ensureOrg(
  ctx: MutationCtx,
  name?: string,
): Promise<{
  orgId: Id<"clubs">;
  name: string;
  state: ClubState;
  view: ReturnType<typeof computeView>;
}> {
  const { orgId, name: clubName, state } = await ensureOrgDoc(ctx, name);
  return { orgId, name: clubName, state, view: computeView(state) };
}

async function applyEngine(
  ctx: MutationCtx,
  fn: (state: ClubState) => EngineResult,
): Promise<EngineResult> {
  const { club, state: before } = await ensureOrgDoc(ctx);
  // `saveState` diffs against `before`, so the transition runs on a copy.
  const result = fn({ ...before, now: new Date().toISOString() });
  if (!result.error) {
    await saveState(ctx.db, club, before, result.state);
  }
  return result;
}

export const getOrganization = query({
  args: {},
  handler: async (ctx) => {
    const org = await loadOrgForSession(ctx);
    if (!org) return null;
    const state = await loadState(ctx.db, org);
    return {
      id: org._id,
      name: org.name,
      now: org.now,
      people: state.people.length,
      referrals: state.referrals.length,
      members: state.people.filter((p) => p.status === "member").length,
    };
  },
});

export const getBoard = query({
  args: {},
  handler: async (ctx) => {
    const org = await loadOrgForSession(ctx);
    if (!org) return null;
    const state = await loadState(ctx.db, org);
    return { state, view: computeView(state) } satisfies EngineResult;
  },
});

export const createOrganization = mutation({
  args: { name: optionalName },
  handler: async (ctx, args) => {
    return await ensureOrg(ctx, args.name);
  },
});

export const ensureOrganization = mutation({
  args: { name: optionalName },
  handler: async (ctx, args) => {
    return await ensureOrg(ctx, args.name);
  },
});

export const addPerson = mutation({
  args: {
    name: v.string(),
    bio: optionalName,
    affiliation: optionalName,
    phone: optionalName,
    linkedin: optionalName,
    resume: optionalName,
    status: v.optional(personStatus),
  },
  handler: async (ctx, args) => {
    const result = await applyEngine(ctx, (state) => addPersonEngine(state, args));
    const added = result.error ? undefined : result.state.people.at(-1);
    // An outbound selection enters the process: score the candidate's evidence before s0 is due.
    if (added && added.status === "candidate") {
      await ctx.scheduler.runAfter(0, internal.evidence.intake, { personId: added.id });
    }
    return result;
  },
});

export const setStatus = mutation({
  args: {
    personId: v.string(),
    status: personStatus,
  },
  handler: async (ctx, args) => {
    return await applyEngine(ctx, (state) => setStatusEngine(state, args.personId, args.status));
  },
});

export const decide = mutation({
  args: {
    personId: v.string(),
    decision: v.union(
      v.literal("start_review"),
      v.literal("admit"),
      v.literal("deny"),
      v.literal("request_data"),
      v.literal("reopen"),
    ),
  },
  handler: async (ctx, args) => {
    return await applyEngine(ctx, (state) => decideEngine(state, args.personId, args.decision));
  },
});

/** Member referral entry (spec page 1). The council page reads these; it does not write them. */
export const addReferral = mutation({
  args: {
    referrerId: v.string(),
    candidateId: v.string(),
    conviction: scale5,
    confidence: scale5,
    relationshipDepth: scale5,
    evidenceType,
    evidenceText: v.string(),
  },
  handler: async (ctx, args) => {
    return await applyEngine(ctx, (state) => addReferralEngine(state, args));
  },
});

export const requestFeedback = mutation({
  args: {
    candidateId: v.string(),
    memberIds: v.array(v.string()),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    return await applyEngine(ctx, (state) => requestFeedbackEngine(state, args));
  },
});

export const recordFeedback = mutation({
  args: {
    requestId: v.optional(v.string()),
    evaluatorId: v.string(),
    candidateId: v.string(),
    dimension,
    score: rubricScore,
    confidence: nullableScale5,
    evidenceText: v.string(),
  },
  handler: async (ctx, args) => {
    return await applyEngine(ctx, (state) => recordFeedbackEngine(state, args));
  },
});

export const setReviewConfig = mutation({
  args: { requiredDimensions: v.array(dimension) },
  handler: async (ctx, args) => {
    return await applyEngine(ctx, (state) => setReviewConfigEngine(state, args));
  },
});

/** Session role. Stored clubAccounts wins; else bootstrap / listed emails. */
export const getMyRole = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    const email = typeof user.email === "string" ? user.email : "";
    return { role: await roleForUser(ctx, user), email };
  },
});

/** Shared member forum. Any signed-in account can read and post. */
export const listPosts = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    const club = await loadClub(ctx.db);
    if (!club) return [];
    const rows = await ctx.db
      .query("clubPosts")
      .withIndex("by_club_and_created", (q) => q.eq("clubId", club._id))
      .order("desc")
      .take(100);
    return rows.map((row) => ({
      id: row._id,
      body: row.body,
      authorName: row.authorName,
      createdAt: row.createdAt,
    }));
  },
});

export const addPost = mutation({
  args: { body: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    const body = args.body.trim();
    if (body.length === 0) return;
    // Posts belong to the club; before an admin creates it there is no forum to post to.
    const club = await loadClub(ctx.db);
    if (!club) return;
    const authorName =
      (typeof user.name === "string" && user.name.trim()) ||
      (typeof user.email === "string" && user.email.trim()) ||
      "Member";
    await ctx.db.insert("clubPosts", {
      clubId: club._id,
      body,
      authorName,
      authorUserId: user._id,
      createdAt: new Date().toISOString(),
    });
  },
});

/** Shared directory. Any signed-in account; members only, no scores. */
export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    const club = await loadClub(ctx.db);
    if (!club) return [];
    const members = await ctx.db
      .query("clubPeople")
      .withIndex("by_club_and_status", (q) => q.eq("clubId", club._id).eq("status", "member"))
      .collect();
    return toDirectoryMembers(members);
  },
});

function sessionEmail(user: { email?: string }): string {
  return typeof user.email === "string" ? user.email : "";
}

/** Open feedback asks for the signed-in member. Other people's requests stay out. */
export const listMyFeedback = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    const club = await loadClub(ctx.db);
    return listOwnFeedbackRequests({
      orgs: club ? [{ key: club._id, state: await loadState(ctx.db, club) }] : [],
      email: sessionEmail(user),
      clock: new Date().toISOString(),
    });
  },
});

/**
 * Member answer. Same `recordFeedback` evaluation the council records.
 * Ownership, a closed request, and an empty observation are rejected here.
 */
export const respondToFeedback = mutation({
  args: {
    requestId: v.string(),
    dimension,
    score: rubricScore,
    confidence: nullableScale5,
    evidenceText: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    const club = await loadClub(ctx.db);
    if (!club) return { error: "Club is not set up yet." };
    const before = await loadState(ctx.db, club);
    const plan = prepareMemberResponse({
      orgs: [{ key: club._id, state: before }],
      email: sessionEmail(user),
      response: args,
      now: new Date().toISOString(),
    });
    if (plan.key === null) return { error: plan.error };
    await saveState(ctx.db, club, before, plan.state);
    return { ok: true as const };
  },
});

// Kept exported for schema consumers; the council page records compares elsewhere.
export { comparisonOutcome };
