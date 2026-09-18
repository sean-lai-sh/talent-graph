"use client";

import Link from "next/link";
import { useState } from "react";
import { SignInForm } from "@/components/auth/SignInForm.tsx";
import { ChipViewer } from "@/components/landing/ChipViewer.tsx";
import { authClient } from "@/lib/auth-client";

export function LandingPage() {
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user);
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <main className="landing">
      <ChipViewer />
      <h1>tech@nyu chips</h1>
      <div className="landing-door">
        {signedIn ? (
          <Link href="/club">Open club</Link>
        ) : signInOpen ? (
          <SignInForm variant="landing" />
        ) : (
          <button type="button" onClick={() => setSignInOpen(true)}>
            Sign in
          </button>
        )}
      </div>
    </main>
  );
}
