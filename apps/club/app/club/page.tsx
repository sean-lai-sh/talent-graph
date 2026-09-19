import { redirect } from "next/navigation";
import { hasClubSession } from "@/lib/clubSession.ts";
import { clubLoginHref } from "@/lib/loginReturnPath.ts";
import { ClubShell } from "./ClubShell";

/**
 * Real-organization door. Official Convex + Better Auth gates here.
 * Unauthenticated visitors redirect to `/login`. Public signup is disabled.
 * The hidden seed board is `/demo` (`/example` redirects there).
 */
export default async function RealClubDoor() {
  if (!(await hasClubSession())) {
    redirect(clubLoginHref("/club"));
  }
  return <ClubShell />;
}
