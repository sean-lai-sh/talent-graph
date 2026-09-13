import { ClubShell } from "./ClubShell";

/**
 * Real-organization door. Official Convex + Better Auth gates here.
 * Unauthenticated visitors see sign-in only. Public `/example`
 * stays unauthenticated generateSeed(). `/` redirects there.
 */
export default function RealClubDoor() {
  return <ClubShell />;
}
