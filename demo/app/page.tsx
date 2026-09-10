import { ClubBoard } from "../components/ClubBoard.tsx";
import { loadClub } from "../lib/engine.ts";

export const dynamic = "force-dynamic";

export default function Home() {
  const initial = loadClub();
  return <ClubBoard initial={initial} />;
}
