import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * App schema stub. Better Auth tables live in the `@convex-dev/better-auth`
 * component. Club persistence is SEA-10 — do not copy engine formulas here.
 */
export default defineSchema({
  clubOrgs: defineTable({
    name: v.string(),
  }),
});
