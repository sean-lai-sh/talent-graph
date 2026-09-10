import { ClubBoard } from "../../components/ClubBoard.tsx";
import { loadClub } from "../../lib/engine.ts";

export const dynamic = "force-dynamic";

/** Same public example admin as `/`. Explicit door name. */
export default function ExampleAdminDoor() {
  const initial = loadClub();
  return <ClubBoard initial={initial} />;
}
