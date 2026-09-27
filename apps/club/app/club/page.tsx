import { redirect } from "next/navigation";
import { decideClubPage, MEMBER_HOME } from "@/lib/clubRole.ts";
import { hasClubSession, readSessionRole } from "@/lib/clubSession.ts";
import { clubLoginHref } from "@/lib/loginReturnPath.ts";
import { ClubShell } from "./ClubShell";

/**
 * Admin council door. Official Convex + Better Auth gates here.
 * Unauthenticated visitors redirect to `/login`. A signed-in non-admin
 * is redirected to `/members` before ClubShell renders. If the role read
 * fails, ClubShell still redirects on the client. Public signup is disabled.
 * The hidden seed board is `/demo` (`/example` redirects there).
 */
export default async function RealClubDoor() {
  const signedIn = await hasClubSession();
  const role = signedIn ? await readSessionRole() : undefined;
  const decision = decideClubPage({ signedIn, role });
  if (decision === "login") {
    redirect(clubLoginHref("/club"));
  }
  if (decision === "members") {
    redirect(MEMBER_HOME);
  }
  // "council" renders the board. "defer" keeps ClubShell's client redirect.
  return <ClubShell />;
}
