"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { convexConfigured } from "@/lib/convexEnv";
import { clubLoginHref, SIGN_OUT_HREF } from "@/lib/loginReturnPath.ts";
import { PersistedClub } from "./PersistedClub";

/**
 * Official Better Auth + Convex gate on the /club door only.
 * Unauthenticated visitors go to `/login` — never the seed board
 * and never PersistedClub. `/demo` is the hidden public seed.
 * Signed-in owners land on the council board. The member forum is `/members`.
 */
export function ClubShell() {
  const configured = convexConfigured();

  return (
    <div className="bg-canvas text-ink">
      {!configured ? (
        <ClubSignInRedirect />
      ) : (
        <>
          <AuthLoading>
            <p className="p-8 text-sm text-muted">Checking session…</p>
          </AuthLoading>
          <Unauthenticated>
            <ClubSignInRedirect />
          </Unauthenticated>
          <Authenticated>
            <ClubSignedIn />
          </Authenticated>
        </>
      )}
    </div>
  );
}

function ClubSignedIn() {
  const router = useRouter();
  return (
    <PersistedClub
      onSignOut={() => {
        void authClient.signOut().then(() => {
          router.replace(SIGN_OUT_HREF);
        });
      }}
    />
  );
}

function ClubSignInRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(clubLoginHref("/club"));
  }, [router]);
  return <p className="p-8 text-sm text-muted">Redirecting to sign in…</p>;
}
