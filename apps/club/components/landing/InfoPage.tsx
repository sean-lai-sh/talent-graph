"use client";

import { ChipViewer } from "@/components/landing/ChipViewer.tsx";
import { authClient } from "@/lib/auth-client";
import { CHIPS_CONTACT, CHIPS_INFO_COPY } from "@/lib/chipsInfo.ts";

/** Same chip. login and contact sit in a row above the about copy; underlined home under it. */
export function InfoPage() {
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user);

  return (
    <main className="landing">
      <ChipViewer />
      <div className="info-corner">
        <nav className="info-nav">
          {signedIn ? <a href="/club">open club</a> : <a href="/login">login</a>}
          <a href={`mailto:${CHIPS_CONTACT}`}>contact</a>
        </nav>
        <p className="info-copy">{CHIPS_INFO_COPY}</p>
        <a className="info-home" href="/">
          home
        </a>
      </div>
    </main>
  );
}
