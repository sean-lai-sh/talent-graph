"use client";

import { ChipViewer } from "@/components/landing/ChipViewer.tsx";

/** Quiet chips canvas. Sign-in lives on `/info`. */
export function LandingPage() {
  return (
    <main className="landing">
      <ChipViewer />
      <a className="info-underline" href="/info">
        info
      </a>
    </main>
  );
}
