import type { BetterAuthOptions } from "better-auth";
import { ensureClub, loadClub, loadState, saveState } from "../lib/clubStore.ts";
import {
  deploymentLabel,
  devSeedEnvError,
  EXAMPLE_CLUB_NAME,
  EXAMPLE_NOW,
  EXAMPLE_REFERRERS,
  exampleLoginAccounts,
  isDuplicateReferral,
  isExampleEmail,
  isExamplePersonId,
  planExampleSeed,
} from "../lib/devSeedPlan.ts";
import { EXAMPLE_REQUIRED_DIMENSIONS } from "../lib/engine.ts";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { authComponent } from "./auth";
import {
  insertMemberReferralLink,
  insertReferralContact,
  saveOwnedMemberReferral,
} from "./referral";

type AuthRow = { id?: string; _id?: string };

function rowId(row: AuthRow | null | undefined): string | undefined {
  return row?.id ?? row?._id;
}

function adapterFor(ctx: MutationCtx) {
  return authComponent.adapter(ctx)({} as BetterAuthOptions);
}

function requireDevSeed(): void {
  const flag = process.env.CLUB_DEV_SEED;
  const refusal = devSeedEnvError(flag === undefined ? {} : { CLUB_DEV_SEED: flag });
  if (refusal) throw new Error(refusal);
}

async function userIdForEmail(ctx: MutationCtx, email: string): Promise<string | undefined> {
  const found = (await adapterFor(ctx).findOne({
    model: "user",
    where: [{ field: "email", value: email }],
  })) as AuthRow | null;
  return rowId(found);
}

async function deleteAuthUser(ctx: MutationCtx, email: string): Promise<void> {
  const adapter = adapterFor(ctx);
  const userId = await userIdForEmail(ctx, email);
  if (!userId) return;
  await adapter.deleteMany({ model: "session", where: [{ field: "userId", value: userId }] });
  await adapter.deleteMany({ model: "account", where: [{ field: "userId", value: userId }] });
  await adapter.delete({ model: "user", where: [{ field: "id", value: userId }] });
}

async function counts(ctx: MutationCtx, clubId: Id<"clubs"> | null) {
  const db = ctx.db;
  const byClub = async (
    table:
      | "clubPeople"
      | "clubReferrals"
      | "clubComparisons"
      | "clubEvaluations"
      | "clubFeedbackRequests",
  ) => {
    if (!clubId) return 0;
    const rows = await db
      .query(table)
      .withIndex("by_club", (q) => q.eq("clubId", clubId))
      .collect();
    return rows.length;
  };
  const links = clubId
    ? await db
        .query("memberReferrals")
        .withIndex("by_club_referrer_and_contact", (q) => q.eq("clubId", clubId))
        .collect()
    : [];
  const contacts = clubId
    ? await db
        .query("referralContacts")
        .withIndex("by_club_and_contact", (q) => q.eq("clubId", clubId))
        .collect()
    : [];
  const accounts = await db.query("clubAccounts").collect();
  const clubs = await db.query("clubs").collect();
  return {
    clubs: clubs.length,
    clubPeople: await byClub("clubPeople"),
    memberReferrals: links.length,
    referralContacts: contacts.length,
    clubReferrals: await byClub("clubReferrals"),
    clubComparisons: await byClub("clubComparisons"),
    clubEvaluations: await byClub("clubEvaluations"),
    clubFeedbackRequests: await byClub("clubFeedbackRequests"),
    clubAccounts: accounts.length,
  };
}

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireDevSeed();
    const existing = await loadClub(ctx.db);
    const created = await ensureClub(ctx.db, "example-seed", EXAMPLE_CLUB_NAME);
    let club = created;
    if (!existing) {
      await ctx.db.patch(created._id, {
        config: { requiredDimensions: [...EXAMPLE_REQUIRED_DIMENSIONS] },
      });
      const reloaded = await ctx.db.get(created._id);
      if (!reloaded) throw new Error("example club was not stored");
      club = reloaded;
    }

    const userIdByEmail: Record<string, string> = {};
    for (const referrer of EXAMPLE_REFERRERS) {
      const userId = await userIdForEmail(ctx, referrer.email);
      if (!userId) {
        throw new Error(
          `No login for ${referrer.email}. Provision example accounts before writing rows.`,
        );
      }
      userIdByEmail[referrer.email] = userId;
    }

    const before = await loadState(ctx.db, club);
    const linkRows = await ctx.db
      .query("memberReferrals")
      .withIndex("by_club_referrer_and_contact", (q) => q.eq("clubId", club._id))
      .collect();
    const contactRows = await ctx.db
      .query("referralContacts")
      .withIndex("by_club_and_contact", (q) => q.eq("clubId", club._id))
      .collect();
    const plan = planExampleSeed({
      state: before,
      userIdByEmail,
      linked: new Set(linkRows.map((row) => `${row.referrerUserId}|${row.personId}`)),
      contacts: new Set(contactRows.map((row) => row.normalizedContact)),
    });
    await saveState(ctx.db, club, before, plan.state);
    const stamped = await ctx.db.get(club._id);
    if (!stamped) throw new Error("example club was not stored");
    club = stamped;
    for (const contact of plan.contacts) {
      await insertReferralContact(ctx.db, club._id, contact);
    }
    for (const link of plan.links) {
      await insertMemberReferralLink(ctx.db, club._id, link);
    }
    for (const job of plan.jobs) {
      const saved = await saveOwnedMemberReferral(ctx, club, {
        referrerUserId: userIdByEmail[job.referrerEmail] ?? "",
        email: job.referrerEmail,
        personId: job.candidateId,
        answers: job.answers,
        now: EXAMPLE_NOW,
      });
      if ("error" in saved && !isDuplicateReferral(saved.error)) {
        throw new Error(saved.error);
      }
    }

    return {
      target: deploymentLabel(process.env.CONVEX_DEPLOYMENT),
      counts: await counts(ctx, club._id),
      referrerEmails: EXAMPLE_REFERRERS.map((person) => person.email),
    };
  },
});

export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireDevSeed();
    const club = await loadClub(ctx.db);
    if (club) await deleteExampleRows(ctx, club._id);
    const emails = new Set(exampleLoginAccounts().map((account) => account.email));
    const accounts = await ctx.db.query("clubAccounts").collect();
    for (const account of accounts) {
      if (isExampleEmail(account.email)) emails.add(account.email.trim().toLowerCase());
    }
    for (const email of emails) await deleteAuthUser(ctx, email);
    for (const account of accounts) {
      if (isExampleEmail(account.email)) await ctx.db.delete(account._id);
    }
    return {
      target: deploymentLabel(process.env.CONVEX_DEPLOYMENT),
      counts: await counts(ctx, club?._id ?? null),
    };
  },
});

async function deleteExampleRows(ctx: MutationCtx, clubId: Id<"clubs">): Promise<void> {
  const db = ctx.db;
  const people = await db
    .query("clubPeople")
    .withIndex("by_club", (q) => q.eq("clubId", clubId))
    .collect();
  const referrals = await db
    .query("clubReferrals")
    .withIndex("by_club", (q) => q.eq("clubId", clubId))
    .collect();
  const comparisons = await db
    .query("clubComparisons")
    .withIndex("by_club", (q) => q.eq("clubId", clubId))
    .collect();
  const evaluations = await db
    .query("clubEvaluations")
    .withIndex("by_club", (q) => q.eq("clubId", clubId))
    .collect();
  const feedback = await db
    .query("clubFeedbackRequests")
    .withIndex("by_club", (q) => q.eq("clubId", clubId))
    .collect();
  const links = await db
    .query("memberReferrals")
    .withIndex("by_club_referrer_and_contact", (q) => q.eq("clubId", clubId))
    .collect();
  const contacts = await db
    .query("referralContacts")
    .withIndex("by_club_and_contact", (q) => q.eq("clubId", clubId))
    .collect();

  for (const row of referrals) {
    if (isExamplePersonId(row.referrerId) || isExamplePersonId(row.candidateId)) {
      await db.delete(row._id);
    }
  }
  for (const row of comparisons) {
    if (
      isExamplePersonId(row.evaluatorId) ||
      isExamplePersonId(row.personAId) ||
      isExamplePersonId(row.personBId)
    ) {
      await db.delete(row._id);
    }
  }
  for (const row of evaluations) {
    if (isExamplePersonId(row.evaluatorId) || isExamplePersonId(row.candidateId)) {
      await db.delete(row._id);
    }
  }
  for (const row of feedback) {
    if (isExamplePersonId(row.candidateId) || isExamplePersonId(row.memberId)) {
      await db.delete(row._id);
    }
  }
  for (const row of links) {
    if (isExamplePersonId(row.personId)) await db.delete(row._id);
  }
  for (const row of contacts) {
    if (isExamplePersonId(row.personId)) await db.delete(row._id);
  }
  for (const row of people) {
    if (isExamplePersonId(row.id)) await db.delete(row._id);
  }
}
