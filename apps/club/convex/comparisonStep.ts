import { v } from "convex/values";
import type { Dimension } from "../../../src/domain/types.ts";
import { loadClub, loadState, saveState } from "../lib/clubStore.ts";
import {
  commitLadderPlacement,
  type LadderPlacement,
  openComparisonStep,
  SIGN_IN_REQUIRED,
} from "../lib/ladderPlacement.ts";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { dimension } from "./schema";

const placement = v.union(
  v.object({
    kind: v.literal("order"),
    order: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("cant_place"),
  }),
);

async function ownedReferral(
  ctx: QueryCtx | MutationCtx,
  clubId: Id<"clubs">,
  referrerUserId: string,
  personId: string,
) {
  return await ctx.db
    .query("memberReferrals")
    .withIndex("by_club_referrer_and_contact", (q) =>
      q.eq("clubId", clubId).eq("referrerUserId", referrerUserId),
    )
    .filter((q) => q.eq(q.field("personId"), personId))
    .first();
}

function sessionEmail(user: { email?: string }): string {
  return typeof user.email === "string" ? user.email : "";
}

/**
 * Anchors for the Ladder step. Session, a memberReferrals row, and a
 * resolved referrer are required. This is a member path, not the council gate.
 */
export const getComparisonStep = query({
  args: { personId: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error(SIGN_IN_REQUIRED);
    const club = await loadClub(ctx.db);
    if (!club) return { ok: false as const, error: "Club is not set up yet." };
    const owned = await ownedReferral(ctx, club._id, user._id, args.personId);
    const state = await loadState(ctx.db, club);
    return openComparisonStep({
      session: { email: sessionEmail(user) },
      ownedPersonIds: owned ? [args.personId] : [],
      state,
      personId: args.personId,
    });
  },
});

/**
 * Records one Ladder placement. Recomputes the offered anchors inside
 * `commitLadderPlacement` and writes them with `addComparison`.
 */
export const submitLadderPlacement = mutation({
  args: {
    personId: v.string(),
    dimension,
    placement,
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error(SIGN_IN_REQUIRED);
    const club = await loadClub(ctx.db);
    if (!club) return { error: "Club is not set up yet." };
    const owned = await ownedReferral(ctx, club._id, user._id, args.personId);
    const before = await loadState(ctx.db, club);
    const submitted: LadderPlacement =
      args.placement.kind === "cant_place"
        ? { kind: "cant_place" }
        : { kind: "order", order: args.placement.order };
    const result = commitLadderPlacement({
      session: { email: sessionEmail(user) },
      ownedPersonIds: owned ? [args.personId] : [],
      state: before,
      personId: args.personId,
      dimension: args.dimension as Dimension,
      placement: submitted,
    });
    if (!result.ok) return { error: result.error };
    await saveState(ctx.db, club, before, result.state);
    return { ok: true as const };
  },
});
