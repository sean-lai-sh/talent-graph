import type { Metadata } from "next";
import { ClubBoard } from "../../components/ClubBoard.tsx";
import { loadClub } from "../../lib/engine.ts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Talent Graph · demo",
};

/** Hidden public seed board. Not linked from the landing. Refresh restores generateSeed(). */
export default function HiddenDemoBoard() {
  const initial = loadClub();
  return <ClubBoard initial={initial} />;
}
