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
  resumeClaimError,
  resumeFileError,
  statusLine,
  UPLOAD_URL_LIMIT,
  uploadUrlAllowed,
} from "../lib/referralSignup.ts";
import { loadClub } from "../lib/theClub.ts";
import type { ClubPerson } from "../lib/types.ts";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

async function profileExists(ctx: QueryCtx | MutationCtx, contact: NormalizedContact) {
  const indexed = await ctx.db
    .query("referralContacts")
    .withIndex("by_contact", (q) => q.eq("normalizedContact", contact.value))
    .unique();
  if (indexed) return true;
  const club = await loadClub(ctx.db);
  return profileExistsInPeople(club?.people ?? [], contact);
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
    const actor = { email: user.email };
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
    return row ? { line: statusLine(row.createdAt) } : null;
  },
});

async function deleteIfNotResume(ctx: MutationCtx, storageId: Id<"_storage">) {
  const file = await ctx.db.system.get("_storage", storageId);
  const error = resumeFileError(file);
  if (error && file) await ctx.storage.delete(storageId);
  return error;
}

function uploadByStorage(ctx: MutationCtx, storageId: Id<"_storage">) {
  return ctx.db
    .query("referralUploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .unique();
}

export const generateResumeUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<{ url: string } | { error: string }> => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Sign in required.");
    const now = Date.now();
    const recent = await ctx.db
      .query("referralUploads")
      .withIndex("by_uploader", (q) =>
        q.eq("uploaderUserId", user._id).gt("createdAt", now - UPLOAD_URL_LIMIT.windowMs),
      )
      .take(UPLOAD_URL_LIMIT.perMember);
    if (
      !uploadUrlAllowed(
        recent.map((row) => row.createdAt),
        now,
      )
    ) {
      return { error: "Too many resume uploads. Try again in an hour." };
    }
    await ctx.db.insert("referralUploads", { uploaderUserId: user._id, createdAt: now });
    return { url: await ctx.storage.generateUploadUrl() };
  },
});

export const registerResumeUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<{ ok: true } | { error: string }> => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Sign in required.");
    if (await uploadByStorage(ctx, args.storageId)) return { error: "Upload the resume again." };
    const pending = await ctx.db
      .query("referralUploads")
      .withIndex("by_uploader", (q) => q.eq("uploaderUserId", user._id))
      .order("desc")
      .filter((q) => q.eq(q.field("storageId"), undefined))
      .first();
    if (!pending) return { error: "Upload the resume again." };
    const error = await deleteIfNotResume(ctx, args.storageId);
    if (error) return { error };
    await ctx.db.patch(pending._id, { storageId: args.storageId });
    return { ok: true };
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
    const actor = { email: user.email };
    const upload = args.resumeStorageId ? await uploadByStorage(ctx, args.resumeStorageId) : null;
    let resumeUrl: string | undefined;
    if (args.resumeStorageId) {
      const error =
        resumeClaimError(upload, user._id) ?? (await deleteIfNotResume(ctx, args.resumeStorageId));
      if (error) return { status: "rejected" as const, error };
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

    const club = await loadClub(ctx.db);
    if (!club) {
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
    if (upload) await ctx.db.patch(upload._id, { usedAt: Date.now() });
    const people = mergeCandidate(club.people as ClubPerson[], plan.person);
    if (people.length !== club.people.length) {
      await ctx.db.patch(club._id, { people });
    }
    return { status: "created" as const, token: issued.token };
  },
});
