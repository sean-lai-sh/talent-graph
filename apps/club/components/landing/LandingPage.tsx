"use client";

import { ChipViewer } from "@/components/landing/ChipViewer.tsx";
import { authClient } from "@/lib/auth-client";

export function LandingPage() {
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user);

  return (
    <>
      <div className="landing-door">
        {signedIn ? <a href="/club">Open club</a> : <a href="/login">Sign in</a>}
      </div>
      <main className="landing">
        <ChipViewer />
        <h1>tech@nyu chips</h1>
      </main>
    </>
  );
}
