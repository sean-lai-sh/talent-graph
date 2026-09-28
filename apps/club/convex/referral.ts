import { v } from "convex/values";
import { loadClub } from "../lib/clubStore.ts";
import { membersWithEmail, newDomainId, planReferralAnswers } from "../lib/referralAnswers.ts";
import {
  hashStatusToken,
  isSelfContact,
  type LookupDecision,
  lookupDecision,
  type NormalizedContact,
  newStatusToken,
  type PersonMatch,
  parseContact,
  peopleWithContact,
  personMatch,
  planSignup,
  resumeClaimError,
  resumeFileError,
  statusLine,
  UPLOAD_URL_LIMIT,
  uploadUrlAllowed,
} from "../lib/referralSignup.ts";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { evidenceType, scale5 } from "./schema";

async function findProfile(
  ctx: QueryCtx | MutationCtx,
  clubId: Id<"clubs">,
  contact: NormalizedContact,
): Promise<PersonMatch> {
  const indexed = await ctx.db
    .query("referralContacts")
    .withIndex("by_club_and_contact", (q) =>
      q.eq("clubId", clubId).eq("normalizedContact", contact.value),
    )
    .unique();
  if (indexed) return { kind: "person", personId: indexed.personId };
  if (contact.kind === "email") {
    return personMatch(
      await ctx.db
        .query("clubPeople")
        .withIndex("by_club_and_email", (q) => q.eq("clubId", clubId).eq("email", contact.value))
        .take(2),
    );
  }
  // Council-entered phones are stored as typed, so an exact index hit can miss
  // them; compare every phone-bearing row under the same normalization.
  const withPhone = await ctx.db
    .query("clubPeople")
    .withIndex("by_club_and_phone", (q) => q.eq("clubId", clubId).gte("phone", ""))
    .collect();
  return personMatch(peopleWithContact(withPhone, contact));
}

async function referrerAlreadyLinked(
  ctx: QueryCtx | MutationCtx,
  clubId: Id<"clubs">,
  userId: string,
  contact: NormalizedContact,
) {
  const row = await ctx.db
    .query("memberReferrals")
    .withIndex("by_club_referrer_and_contact", (q) =>
      q.eq("clubId", clubId).eq("referrerUserId", userId).eq("normalizedContact", contact.value),
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
    const club = parsed.ok && !isSelfContact(actor, parsed.contact) ? await loadClub(ctx.db) : null;
    const exists =
      club && parsed.ok
        ? (await findProfile(ctx, club._id, parsed.contact)).kind !== "none"
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

    const club = await loadClub(ctx.db);
    const parsed = parseContact(args.contact);
    const self = parsed.ok && isSelfContact(actor, parsed.contact);
    const exists =
      club && parsed.ok && !self
        ? (await findProfile(ctx, club._id, parsed.contact)).kind !== "none"
        : false;
    const linked =
      club && parsed.ok && !self
        ? await referrerAlreadyLinked(ctx, club._id, user._id, parsed.contact)
        : false;
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

    if (!club) {
      return { status: "rejected" as const, error: "Club is not set up yet." };
    }

    await ctx.db.insert("clubPeople", { clubId: club._id, ...plan.person });
    await ctx.db.insert("referralContacts", {
      clubId: club._id,
      normalizedContact: plan.contact.value,
      kind: plan.contact.kind,
      personId: plan.person.id,
    });
    await ctx.db.insert("memberReferrals", {
      clubId: club._id,
      referrerUserId: plan.referrerUserId,
      normalizedContact: plan.contact.value,
      personId: plan.person.id,
      createdAt: plan.createdAt,
      tokenHash: plan.tokenHash,
    });
    if (upload) await ctx.db.patch(upload._id, { usedAt: Date.now() });
    return { status: "created" as const, token: issued.token };
  },
});

export const submitReferralAnswers = mutation({
  args: {
    contact: v.string(),
    conviction: scale5,
    confidence: scale5,
    relationshipDepth: scale5,
    evidenceType,
    evidenceText: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Sign in required.");
    const club = await loadClub(ctx.db);
    if (!club) return { status: "rejected" as const, error: "Club is not set up yet." };
    const { contact, ...answers } = args;
    const parsed = parseContact(contact);
    if (!parsed.ok) return { status: "rejected" as const, error: parsed.error };

    const candidate = await findProfile(ctx, club._id, parsed.contact);
    const members = await ctx.db
      .query("clubPeople")
      .withIndex("by_club_and_status", (q) => q.eq("clubId", club._id).eq("status", "member"))
      .collect();
    const referrer = personMatch(membersWithEmail(members, user.email));
    const existing =
      referrer.kind === "person" && candidate.kind === "person"
        ? await ctx.db
            .query("clubReferrals")
            .withIndex("by_club_referrer_and_candidate", (q) =>
              q
                .eq("clubId", club._id)
                .eq("referrerId", referrer.personId)
                .eq("candidateId", candidate.personId),
            )
            .first()
        : null;
    const issued = await newStatusToken();
    const nowMs = Date.now();
    const plan = planReferralAnswers({
      contact: parsed.contact,
      candidate,
      referrer,
      userId: user._id,
      existing,
      linked: await referrerAlreadyLinked(ctx, club._id, user._id, parsed.contact),
      answers,
      now: new Date(nowMs).toISOString(),
      clubNow: club.now,
      referralId: newDomainId("ref", nowMs),
      tokenHash: issued.hash,
    });
    if (plan.action === "rejected") return { status: "rejected" as const, error: plan.error };

    if (plan.action === "update") {
      if (!existing) throw new Error("submitReferralAnswers: update planned without a referral");
      await ctx.db.patch(existing._id, plan.patch);
    } else {
      await ctx.db.insert("clubReferrals", { clubId: club._id, ...plan.referral });
    }
    if (plan.link) await ctx.db.insert("memberReferrals", { clubId: club._id, ...plan.link });
    if (plan.clubNow) await ctx.db.patch(club._id, { now: plan.clubNow });
    return plan.link
      ? { status: "saved" as const, token: issued.token }
      : { status: "saved" as const };
  },
});
