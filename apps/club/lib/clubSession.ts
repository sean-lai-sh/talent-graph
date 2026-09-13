import { isAuthenticated } from "./auth-server.ts";
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
