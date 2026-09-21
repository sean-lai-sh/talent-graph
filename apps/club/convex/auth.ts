import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth/minimal";
import type { GenericMutationCtx } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL ?? "";

// Official Convex + Better Auth component client.
export const authComponent = createClient<DataModel>(components.betterAuth);

/**
 * Email/password is on. Public signup is off.
 *
 * Protocol (Better Auth + Convex):
 * - `disableSignUp: true` closes `/sign-up/email`.
 * - `disabledPaths` is a second lock on that route.
 * - Owners are inserted by `provisionUser` (secret-gated) so the first
 *   admin does not depend on the admin plugin's local-install schema.
 * - Hash the password with `better-auth/crypto` *before* calling this
 *   mutation so the plaintext never reaches Convex logs.
 */
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    disabledPaths: ["/sign-up/email"],
    plugins: [convex({ authConfig })],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.safeGetAuthUser(ctx);
  },
});

type AuthRow = {
  id?: string;
  _id?: string;
  email?: string;
  userId?: string;
};

function rowId(row: AuthRow | null | undefined): string | undefined {
  return row?.id ?? row?._id;
}

async function upsertClubAccount(
  ctx: { db: GenericMutationCtx<DataModel>["db"] },
  input: { userId: string; email: string; role: "admin" | "member" },
) {
  const existing = await ctx.db
    .query("clubAccounts")
    .withIndex("by_user", (q) => q.eq("userId", input.userId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { email: input.email, role: input.role });
    return;
  }
  await ctx.db.insert("clubAccounts", input);
}

export const provisionUser = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
    name: v.string(),
    passwordHash: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
  },
  handler: async (ctx, args) => {
    const expected = process.env.ADMIN_PROVISION_SECRET;
    if (!expected) {
      throw new Error("provisioning is not configured");
    }
    if (args.secret !== expected) {
      throw new Error("unauthorized");
    }

    const email = args.email.trim().toLowerCase();
    const name = args.name.trim();
    const role = args.role === "member" ? "member" : "admin";
    if (!email || !name || !args.passwordHash) {
      throw new Error("email, name, and passwordHash are required");
    }

    const adapter = authComponent.adapter(ctx)({} as BetterAuthOptions);
    const now = Date.now();
    const existing = (await adapter.findOne({
      model: "user",
      where: [{ field: "email", value: email }],
    })) as AuthRow | null;

    if (existing) {
      const userId = rowId(existing);
      if (!userId) throw new Error("existing user is missing an id");
      const account = (await adapter.findOne({
        model: "account",
        where: [
          { field: "userId", value: userId },
          { field: "providerId", value: "credential" },
        ],
      })) as AuthRow | null;
      const accountId = rowId(account);
      if (!accountId) {
        await adapter.create({
          model: "account",
          data: {
            userId,
            accountId: userId,
            providerId: "credential",
            password: args.passwordHash,
            createdAt: now,
            updatedAt: now,
          },
        });
        await upsertClubAccount(ctx, { userId, email, role });
        return { email, created: false, rotated: true, role };
      }
      await adapter.update({
        model: "account",
        where: [{ field: "id", value: accountId }],
        update: { password: args.passwordHash, updatedAt: now },
      });
      await upsertClubAccount(ctx, { userId, email, role });
      return { email, created: false, rotated: true, role };
    }

    const created = (await adapter.create({
      model: "user",
      data: {
        name,
        email,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    })) as AuthRow;
    const userId = rowId(created);
    if (!userId) throw new Error("created user is missing an id");
    await adapter.create({
      model: "account",
      data: {
        userId,
        accountId: userId,
        providerId: "credential",
        password: args.passwordHash,
        createdAt: now,
        updatedAt: now,
      },
    });
    await upsertClubAccount(ctx, { userId, email, role });
    return { email, created: true, rotated: false, role };
  },
});
