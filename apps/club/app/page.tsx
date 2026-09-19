import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage.tsx";
import "./landing.css";

export const metadata: Metadata = {
  title: "tech@nyu chips",
  description: "tech@nyu chips",
};

/** Public landing from pope-cruz/chips. Sign-in only; no create-account. */
export default function HomeLanding() {
  return <LandingPage />;
}
