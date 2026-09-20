import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage.tsx";
import "./landing.css";

export const metadata: Metadata = {
  title: "tech@nyu chips",
  description: "tech@nyu chips",
};

/** Public landing from pope-cruz/chips. Underlined info; sign-in lives on `/info`. */
export default function HomeLanding() {
  return <LandingPage />;
}
