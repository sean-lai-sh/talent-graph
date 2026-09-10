import { ClubBoard } from "../components/ClubBoard.tsx";
import { loadClub } from "../lib/engine.ts";

export const dynamic = "force-dynamic";

/** Public example admin. Auth-free; refresh restores the seed club. */
export default function ExampleAdminHome() {
  const initial = loadClub();
  return <ClubBoard initial={initial} />;
}
