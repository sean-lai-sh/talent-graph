import { mutation, query } from "./_generated/server";

/**
 * Empty club persistence surface. SEA-10 will store organization state here.
 * No engine formulas belong in Convex.
 */
export const getOrganization = query({
  args: {},
  handler: async () => {
    return null;
  },
});

export const createOrganization = mutation({
  args: {},
  handler: async () => {
    return null;
  },
});
