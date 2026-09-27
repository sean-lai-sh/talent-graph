import { api } from "../convex/_generated/api";
import { fetchAuthQuery, isAuthenticated } from "./auth-server.ts";
import type { ClubRole } from "./clubRole.ts";
import { convexConfigured } from "./convexEnv.ts";

export async function hasClubSession(): Promise<boolean> {
  if (!convexConfigured()) {
    return false;
  }
  try {
    return await isAuthenticated();
  } catch {
    return false;
  }
}

/**
 * Role from `getMyRole` (stored row, else `resolveRole`). `undefined` means
 * the Convex read failed — the page defers to the client gate. `null` means
 * the query saw no user.
 */
export async function readSessionRole(): Promise<ClubRole | null | undefined> {
  try {
    const me = await fetchAuthQuery(api.club.getMyRole, {});
    if (!me) return null;
    return me.role;
  } catch {
    return undefined;
  }
}
