import type { Metadata } from "next";
import { exampleBoard } from "../../lib/exampleScore.ts";
import { AdminDemo } from "./AdminDemo.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Talent Graph · demo",
};

/**
 * Hidden public admin preview. Not linked from the landing.
 * The server scores the static fixture once and hands the view to the client.
 * No Convex query of any kind.
 */
export default function HiddenDemoBoard() {
  const initial = exampleBoard();
  return <AdminDemo initial={initial} />;
}
