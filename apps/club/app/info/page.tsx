import type { Metadata } from "next";
import { InfoPage } from "@/components/landing/InfoPage.tsx";
import { CHIPS_INFO_COPY } from "@/lib/chipsInfo.ts";
import "../landing.css";

export const metadata: Metadata = {
  title: "info",
  description: CHIPS_INFO_COPY,
};

/** Public program note. Sign-in only; no create-account. */
export default function InfoRoute() {
  return <InfoPage />;
}
