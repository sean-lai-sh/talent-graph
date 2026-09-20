"use client";

import { ChipViewer } from "@/components/landing/ChipViewer.tsx";
import { authClient } from "@/lib/auth-client";
import { CHIPS_CONTACT, CHIPS_INFO_COPY } from "@/lib/chipsInfo.ts";

/** Same chip. Login and contact sit in a small bottom-left stack. */
export function InfoPage() {
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user);

  return (
    <main className="landing">
      <ChipViewer />
      <div className="info-corner">
        <p className="info-copy">{CHIPS_INFO_COPY}</p>
        {signedIn ? <a href="/club">Open club</a> : <a href="/login">Login</a>}
        <a href={`mailto:${CHIPS_CONTACT}`}>{CHIPS_CONTACT}</a>
      </div>
    </main>
  );
}
