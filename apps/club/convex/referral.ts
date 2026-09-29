import { v } from "convex/values";
import { type Club, loadClub, loadState, saveState } from "../lib/clubStore.ts";
import {
  ANSWERS_REJECTED_ERROR,
  commitMemberReferral,
  memberReferralAnswers as parseMemberReferralAnswers,
} from "../lib/memberReferral.ts";
import {
  hashStatusToken,
  isSelfContact,
  type LookupDecision,
  lookupDecision,
  type NormalizedContact,
  newStatusToken,
  parseContact,
  planSignup,
  profileExistsInPeople,
  resumeClaimError,
  resumeFileError,
  type SignupPlan,
  statusLine,
  UPLOAD_URL_LIMIT,
  uploadUrlAllowed,
} from "../lib/referralSignup.ts";
import type { MemberReferralAnswers } from "../lib/types.ts";
import {
  REFERRAL_Q1_CONTEXTS,
  REFERRAL_Q1_LENGTHS,
  REFERRAL_Q1_STAKES,
  REFERRAL_Q2_ROLES,
  REFERRAL_Q3_GROUP_SIZES,
  REFERRAL_Q3_RANKS,
} from "../lib/types.ts";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

async function profileExists(
  ctx: QueryCtx | MutationCtx,
  clubId: Id<"clubs">,
  contact: NormalizedContact,
) {
  const indexed = await ctx.db
    .query("referralContacts")
    .withIndex("by_club_and_contact", (q) =>
      q.eq("clubId", clubId).eq("normalizedContact", contact.value),
    )
    .unique();
  if (indexed) return true;
  if (contact.kind === "email") {
    const person = await ctx.db
      .query("clubPeople")
      .withIndex("by_club_and_email", (q) => q.eq("clubId", clubId).eq("email", contact.value))
      .first();
    return person !== null;
  }
  // Council-entered phones are stored as typed, so an exact index hit can miss
  // them; compare every phone-bearing row under the same normalization.
  const withPhone = await ctx.db
    .query("clubPeople")
    .withIndex("by_club_and_phone", (q) => q.eq("clubId", clubId).gte("phone", ""))
    .collect();
  return profileExistsInPeople(withPhone, contact);
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
    const exists = club && parsed.ok ? await profileExists(ctx, club._id, parsed.contact) : false;
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
      club && parsed.ok && !self ? await profileExists(ctx, club._id, parsed.contact) : false;
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

    await insertSignupRecords(ctx.db, club._id, plan);
    if (upload) await ctx.db.patch(upload._id, { usedAt: Date.now() });
    return { status: "created" as const, token: issued.token };
  },
});

function oneOf<const T extends readonly [string, string, ...string[]]>(values: T) {
  const [first, second, ...rest] = values;
  return v.union(v.literal(first), v.literal(second), ...rest.map((value) => v.literal(value)));
}

const memberReferralAnswers = v.object({
  context: oneOf(REFERRAL_Q1_CONTEXTS),
  length: oneOf(REFERRAL_Q1_LENGTHS),
  stakes: v.array(oneOf(REFERRAL_Q1_STAKES)),
  what: v.string(),
  hard: v.string(),
  distinct: v.string(),
  role: oneOf(REFERRAL_Q2_ROLES),
  rank: oneOf(REFERRAL_Q3_RANKS),
  groupSize: oneOf(REFERRAL_Q3_GROUP_SIZES),
});

/**
 * A signed-in member records Q1–Q3 for a person in the club. The engine
 * referral is `addReferral` inside `commitMemberReferral`, persisted with
 * `loadState` / `saveState`. A person the member had not referred yet also
 * gets their `memberReferrals` row and a status token. Members do not go
 * through the council admin gate.
 */
export const saveMemberReferralAnswers = mutation({
  args: {
    personId: v.string(),
    answers: memberReferralAnswers,
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Sign in required.");
    const club = await loadClub(ctx.db);
    if (!club) return { error: "Club is not set up yet." };
    const answers = parseMemberReferralAnswers(args.answers);
    if (!answers) return { error: ANSWERS_REJECTED_ERROR };
    return await saveOwnedMemberReferral(ctx, club, {
      referrerUserId: user._id,
      email: typeof user.email === "string" ? user.email : "",
      personId: args.personId,
      answers,
    });
  },
});

type SignupCreate = Extract<SignupPlan, { action: "create" }>;

export async function insertReferralContact(
  db: MutationCtx["db"],
  clubId: Id<"clubs">,
  contact: { normalizedContact: string; kind: "email" | "phone"; personId: string },
): Promise<void> {
  await db.insert("referralContacts", { clubId, ...contact });
}

export async function insertMemberReferralLink(
  db: MutationCtx["db"],
  clubId: Id<"clubs">,
  link: {
    referrerUserId: string;
    normalizedContact: string;
    personId: string;
    createdAt: string;
    tokenHash: string;
  },
): Promise<void> {
  await db.insert("memberReferrals", { clubId, ...link });
}

export async function insertSignupRecords(
  db: MutationCtx["db"],
  clubId: Id<"clubs">,
  plan: SignupCreate,
): Promise<void> {
  await db.insert("clubPeople", { clubId, ...plan.person });
  await insertReferralContact(db, clubId, {
    normalizedContact: plan.contact.value,
    kind: plan.contact.kind,
    personId: plan.person.id,
  });
  await insertMemberReferralLink(db, clubId, {
    referrerUserId: plan.referrerUserId,
    normalizedContact: plan.contact.value,
    personId: plan.person.id,
    createdAt: plan.createdAt,
    tokenHash: plan.tokenHash,
  });
}

export async function saveOwnedMemberReferral(
  ctx: MutationCtx,
  club: Club,
  input: {
    referrerUserId: string;
    email: string;
    personId: string;
    answers: MemberReferralAnswers;
    /** Club clock for the referral. The public mutation leaves this unset and uses wall time. */
    now?: string;
  },
): Promise<{ ok: true; token?: string } | { error: string }> {
  const owned = await ctx.db
    .query("memberReferrals")
    .withIndex("by_club_referrer_and_contact", (q) =>
      q.eq("clubId", club._id).eq("referrerUserId", input.referrerUserId),
    )
    .filter((q) => q.eq(q.field("personId"), input.personId))
    .first();
  const before = await loadState(ctx.db, club);
  const submittedAt = input.now ?? new Date().toISOString();
  const result = commitMemberReferral({
    state: before,
    email: input.email,
    candidateId: input.personId,
    referredByUser: owned !== null,
    answers: input.answers,
    submittedAt,
  });
  if (!result.ok) return { error: result.error };
  await saveState(ctx.db, club, before, result.state);
  const contact = result.link?.normalizedContact;
  if (contact === undefined) return { ok: true };
  const linkedByContact = await ctx.db
    .query("memberReferrals")
    .withIndex("by_club_referrer_and_contact", (q) =>
      q
        .eq("clubId", club._id)
        .eq("referrerUserId", input.referrerUserId)
        .eq("normalizedContact", contact),
    )
    .first();
  if (linkedByContact) return { ok: true };
  const issued = await newStatusToken();
  await insertMemberReferralLink(ctx.db, club._id, {
    referrerUserId: input.referrerUserId,
    normalizedContact: contact,
    personId: input.personId,
    createdAt: submittedAt,
    tokenHash: issued.hash,
  });
  return { ok: true, token: issued.token };
}
