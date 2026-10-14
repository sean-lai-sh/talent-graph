import type { Metadata } from "next";
import { loadClub } from "../../lib/engine.ts";
import { AdminDemo } from "./AdminDemo.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Talent Graph · demo",
};

/**
 * Hidden public admin preview. Not linked from the landing.
 * Council board is the in-memory seed (refresh restores generateSeed()).
 * Directory rows are the static fixture. No Convex query of any kind.
 */
export default function HiddenDemoBoard() {
  const initial = loadClub();
  return <AdminDemo initial={initial} />;
}
