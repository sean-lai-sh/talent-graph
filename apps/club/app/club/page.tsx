import { ClubShell } from "./ClubShell";

/**
 * Real-organization door. Official Convex + Better Auth gates here.
 * Unauthenticated visitors see sign-in only. Public signup is disabled.
 * The hidden seed board is `/demo` (`/example` redirects there).
 */
export default function RealClubDoor() {
  return <ClubShell />;
}
