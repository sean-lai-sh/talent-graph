import { v } from "convex/values";
import {
  hashStatusToken,
  isSelfContact,
  type LookupDecision,
  lookupDecision,
  mergeCandidate,
  type NormalizedContact,
  newStatusToken,
  parseContact,
  planSignup,
  profileExistsInPeople,
  readStatus,
} from "../lib/referralSignup.ts";
import type { ClubPerson } from "../lib/types.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

const ORG_SCAN = 20;

type Actor = { email?: string; phone?: string };

function actorFrom(user: { email?: string | null }): Actor {
  const extra = user as {
    email?: string | null;
    phone?: string | null;
    phoneNumber?: string | null;
  };
  const actor: Actor = {};
  if (typeof extra.email === "string" && extra.email.trim()) actor.email = extra.email;
  const phone = typeof extra.phoneNumber === "string" ? extra.phoneNumber : extra.phone;
  if (typeof phone === "string" && phone.trim()) actor.phone = phone;
  return actor;
}

async function profileExists(ctx: QueryCtx | MutationCtx, contact: NormalizedContact) {
  const indexed = await ctx.db
    .query("referralContacts")
    .withIndex("by_contact", (q) => q.eq("normalizedContact", contact.value))
    .unique();
  if (indexed) return true;
  const orgs = await ctx.db.query("clubOrgs").take(ORG_SCAN);
  return profileExistsInPeople(
    orgs.flatMap((org) => org.people),
    contact,
  );
}

async function referrerAlreadyLinked(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  contact: NormalizedContact,
) {
  const row = await ctx.db
    .query("memberReferrals")
    .withIndex("by_referrer_and_contact", (q) =>
      q.eq("referrerUserId", userId).eq("normalizedContact", contact.value),
    )
    .unique();
  return row !== null;
}

export const lookupReferralContact = query({
  args: { contact: v.string() },
  handler: async (ctx, args): Promise<LookupDecision | null> => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    const actor = actorFrom(user);
    const parsed = parseContact(args.contact);
    const exists =
      parsed.ok && !isSelfContact(actor, parsed.contact)
        ? await profileExists(ctx, parsed.contact)
        : false;
    return lookupDecision({ raw: args.contact, actor, profileExists: exists });
  },
});

export const referralStatus = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await hashStatusToken(args.token);
    const row = await ctx.db
      .query("memberReferrals")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    return await readStatus(
      row ? { tokenHash: row.tokenHash, createdAt: row.createdAt } : null,
      args.token,
    );
  },
});

export const generateResumeUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Sign in required.");
    return await ctx.storage.generateUploadUrl();
  },
});

export const submitReferralSignup = mutation({
  args: {
    contact: v.string(),
    name: v.string(),
    affiliation: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    x: v.optional(v.string()),
    website: v.optional(v.string()),
    github: v.optional(v.string()),
    resumeStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Sign in required.");
    const actor = actorFrom(user);
    let resumeUrl: string | undefined;
    if (args.resumeStorageId) {
      const meta = await ctx.storage.getMetadata(args.resumeStorageId);
      if (!meta?.contentType?.startsWith("application/pdf")) {
        return { status: "rejected" as const, error: "Resume must be a PDF." };
      }
      resumeUrl = (await ctx.storage.getUrl(args.resumeStorageId)) ?? undefined;
    }

    const parsed = parseContact(args.contact);
    const self = parsed.ok && isSelfContact(actor, parsed.contact);
    const exists = parsed.ok && !self ? await profileExists(ctx, parsed.contact) : false;
    const linked =
      parsed.ok && !self ? await referrerAlreadyLinked(ctx, user._id, parsed.contact) : false;
    const issued = await newStatusToken();
    const plan = planSignup({
      rawContact: args.contact,
      actor: { ...actor, userId: user._id },
      profileExists: exists,
      referrerAlreadyLinked: linked,
      draft: {
        name: args.name,
        affiliation: args.affiliation ?? "",
        linkedin: args.linkedin ?? "",
        x: args.x ?? "",
        website: args.website ?? "",
        github: args.github ?? "",
        ...(args.resumeStorageId ? { resumeStorageId: args.resumeStorageId } : {}),
        ...(resumeUrl ? { resumeUrl } : {}),
      },
      now: new Date().toISOString(),
      personId: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      tokenHash: issued.hash,
    });

    if (plan.action === "rejected") return { status: "rejected" as const, error: plan.error };
    if (plan.action === "duplicate") return { status: "duplicate" as const };
    if (plan.action === "exists") return { status: "exists" as const };

    const orgs = await ctx.db.query("clubOrgs").take(ORG_SCAN);
    if (orgs.length === 0) {
      return { status: "rejected" as const, error: "Club is not set up yet." };
    }

    await ctx.db.insert("referralContacts", {
      normalizedContact: plan.contact.value,
      kind: plan.contact.kind,
      personId: plan.person.id,
    });
    await ctx.db.insert("memberReferrals", {
      referrerUserId: plan.referrerUserId,
      normalizedContact: plan.contact.value,
      personId: plan.person.id,
      createdAt: plan.createdAt,
      tokenHash: plan.tokenHash,
    });
    for (const org of orgs) {
      const people = mergeCandidate(org.people as ClubPerson[], plan.person);
      if (people.length !== org.people.length) {
        await ctx.db.patch(org._id, { people });
      }
    }
    return { status: "created" as const, token: issued.token };
  },
});
