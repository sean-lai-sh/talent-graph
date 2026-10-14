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
 * Seed data only; refresh restores generateSeed(). No admin Convex query.
 */
export default function HiddenDemoBoard() {
  const initial = loadClub();
  return <AdminDemo initial={initial} />;
}
