import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";
import { type ClubRole, extraAdminEmailsFromEnv, resolveRole } from "../lib/clubRole.ts";
import {
  addPerson as addPersonEngine,
  addReferral as addReferralEngine,
  computeView,
  decide as decideEngine,
  emptyState,
  recordFeedback as recordFeedbackEngine,
  requestFeedback as requestFeedbackEngine,
  setReviewConfig as setReviewConfigEngine,
  setStatus as setStatusEngine,
} from "../lib/engine.ts";
import { toDirectoryMembers } from "../lib/memberDirectory.ts";
import { reviveState } from "../lib/serialize.ts";
import type { ClubState, EngineResult } from "../lib/types.ts";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
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
 * role. Each signed-in admin gets a `clubOrgs` row keyed by `ownerUserId`.
 * Owner-keyed club, not a membership / invite model.
 *
 * Clock: the engine never reads a clock. Each mutation stamps `now` with
 * wall time before running so referrals, decisions, and the 48-hour
 * feedback window carry real timestamps; `getBoard` reads at the last write.
 */

type QueryCtx = GenericQueryCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;

const optionalName = v.optional(v.string());
const nullableScale5 = v.union(scale5, v.null());

function orgToState(org: Doc<"clubOrgs">): ClubState {
  return reviveState({
    people: org.people,
    referrals: org.referrals,
    comparisons: org.comparisons,
    evaluations: org.evaluations,
    outcomes: org.outcomes,
    opportunities: org.opportunities,
    snapshots: org.snapshots,
    feedbackRequests: org.feedbackRequests ?? [],
    config: org.config ?? { requiredDimensions: [] },
    now: org.now,
  } as ClubState);
}

function stateFields(state: ClubState) {
  return {
    now: state.now,
    people: state.people,
    referrals: state.referrals,
    comparisons: state.comparisons,
    evaluations: state.evaluations,
    outcomes: state.outcomes,
    opportunities: state.opportunities,
    snapshots: state.snapshots,
    feedbackRequests: state.feedbackRequests,
    config: state.config,
  };
}

async function loadOwnedOrg(
  ctx: QueryCtx | MutationCtx,
  ownerUserId: string,
): Promise<Doc<"clubOrgs"> | null> {
  return await ctx.db
    .query("clubOrgs")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
    .first();
}

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
async function loadOrgForSession(ctx: QueryCtx | MutationCtx): Promise<Doc<"clubOrgs"> | null> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) return null;
  if ((await roleForUser(ctx, user)) !== "admin") return null;
  return await loadOwnedOrg(ctx, user._id);
}

async function requireAdmin(ctx: MutationCtx): Promise<AuthUser> {
  const user = await authComponent.getAuthUser(ctx);
  if ((await roleForUser(ctx, user)) !== "admin") {
    throw new Error("admin only");
  }
  return user;
}

async function ensureOrg(
  ctx: MutationCtx,
  name?: string,
): Promise<{
  orgId: Id<"clubOrgs">;
  name: string;
  state: ClubState;
  view: ReturnType<typeof computeView>;
}> {
  const user = await requireAdmin(ctx);
  const existing = await loadOwnedOrg(ctx, user._id);
  if (existing) {
    const state = orgToState(existing);
    return {
      orgId: existing._id,
      name: existing.name,
      state,
      view: computeView(state),
    };
  }
  const state = emptyState();
  const orgName = name?.trim() || "Club";
  const orgId = await ctx.db.insert("clubOrgs", {
    ownerUserId: user._id,
    name: orgName,
    ...stateFields(state),
  });
  return { orgId, name: orgName, state, view: computeView(state) };
}

async function applyEngine(
  ctx: MutationCtx,
  fn: (state: ClubState) => EngineResult,
): Promise<EngineResult> {
  const ensured = await ensureOrg(ctx);
  const org = await ctx.db.get(ensured.orgId);
  if (!org) {
    const state = emptyState();
    return { state, view: computeView(state), error: "no organization" };
  }
  const state = orgToState(org);
  state.now = new Date().toISOString();
  const result = fn(state);
  if (!result.error) {
    await ctx.db.patch(org._id, stateFields(result.state));
  }
  return result;
}

export const getOrganization = query({
  args: {},
  handler: async (ctx) => {
    const org = await loadOrgForSession(ctx);
    if (!org) return null;
    return {
      id: org._id,
      name: org.name,
      now: org.now,
      people: org.people.length,
      referrals: org.referrals.length,
      members: org.people.filter((p) => p.status === "member").length,
    };
  },
});

export const getBoard = query({
  args: {},
  handler: async (ctx) => {
    const org = await loadOrgForSession(ctx);
    if (!org) return null;
    const state = orgToState(org);
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
    return await applyEngine(ctx, (state) => addPersonEngine(state, args));
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
    const rows = await ctx.db.query("clubPosts").withIndex("by_created").order("desc").take(100);
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
    const authorName =
      (typeof user.name === "string" && user.name.trim()) ||
      (typeof user.email === "string" && user.email.trim()) ||
      "Member";
    await ctx.db.insert("clubPosts", {
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
    const orgs = await ctx.db.query("clubOrgs").take(20);
    const seen = new Set<string>();
    const people = orgs
      .flatMap((org) => org.people)
      .filter((person) => {
        if (seen.has(person.id)) return false;
        seen.add(person.id);
        return true;
      });
    return toDirectoryMembers(people);
  },
});

// Kept exported for schema consumers; the council page records compares elsewhere.
export { comparisonOutcome };
