import { ClubShell } from "./ClubShell";

/**
 * Real-organization door. Official Convex + Better Auth is wired here.
 * Public `/` and `/example` stay unauthenticated generateSeed().
 */
export default function RealClubDoor() {
  return <ClubShell />;
}
