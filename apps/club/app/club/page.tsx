import { ClubShell } from "./ClubShell";

/**
 * Real-organization door. Official Convex + Better Auth gates here.
 * Unauthenticated visitors see sign-in only. Public `/` and `/example`
 * stay unauthenticated generateSeed().
 */
export default function RealClubDoor() {
  return <ClubShell />;
}
