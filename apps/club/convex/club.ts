import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";
import {
  addComparison as addComparisonEngine,
  addPerson as addPersonEngine,
  addReferral as addReferralEngine,
  computeView,
  emptyState,
  meddleReferral as meddleReferralEngine,
  setNow as setNowEngine,
  setStatus as setStatusEngine,
} from "../lib/engine.ts";
import type { ClubState, EngineResult } from "../lib/types.ts";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { comparisonOutcome, dimension, evidenceType, personStatus, scale5 } from "./schema";

/**
 * Persist club *inputs* here. Every write re-runs views via `lib/engine.ts`
 * (`src/` compute). Do not reimplement scoring / inference / judges.
 *
 * Singleton `clubOrgs.first()` until SEA-12. Mutations are public. This is
 * not per-org isolation — do not treat SEA-10 as a multi-tenant gate.
 */

type QueryCtx = GenericQueryCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;

const optionalName = v.optional(v.string());

function orgToState(org: Doc<"clubOrgs">): ClubState {
  return {
    people: org.people,
    referrals: org.referrals,
    comparisons: org.comparisons,
    evaluations: org.evaluations,
    outcomes: org.outcomes,
    opportunities: org.opportunities,
    snapshots: org.snapshots,
    now: org.now,
  };
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
  };
}

/** One shared document until SEA-12 owns org keys + auth on the data plane. */
async function loadOrg(ctx: QueryCtx | MutationCtx): Promise<Doc<"clubOrgs"> | null> {
  return await ctx.db.query("clubOrgs").first();
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
  const existing = await loadOrg(ctx);
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
  const result = fn(orgToState(org));
  if (!result.error) {
    await ctx.db.patch(org._id, stateFields(result.state));
  }
  return result;
}

export const getOrganization = query({
  args: {},
  handler: async (ctx) => {
    const org = await loadOrg(ctx);
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
    const org = await loadOrg(ctx);
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

export const meddleReferral = mutation({
  args: {
    referralId: v.string(),
    conviction: scale5,
    confidence: scale5,
    relationshipDepth: scale5,
  },
  handler: async (ctx, args) => {
    return await applyEngine(ctx, (state) =>
      meddleReferralEngine(state, args.referralId, {
        conviction: args.conviction,
        confidence: args.confidence,
        relationshipDepth: args.relationshipDepth,
      }),
    );
  },
});

export const addComparison = mutation({
  args: {
    personAId: v.string(),
    personBId: v.string(),
    dimension,
    outcome: comparisonOutcome,
  },
  handler: async (ctx, args) => {
    return await applyEngine(ctx, (state) => addComparisonEngine(state, args));
  },
});

export const setNow = mutation({
  args: { now: v.string() },
  handler: async (ctx, args) => {
    return await applyEngine(ctx, (state) => setNowEngine(state, args.now));
  },
});
