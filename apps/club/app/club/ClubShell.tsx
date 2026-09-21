"use client";

import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { MEMBER_HOME } from "@/lib/clubRole.ts";
import { convexConfigured } from "@/lib/convexEnv";
import { clubLoginHref, SIGN_OUT_HREF } from "@/lib/loginReturnPath.ts";
import { api } from "../../convex/_generated/api";
import { PersistedClub } from "./PersistedClub";

/**
 * Official Better Auth + Convex gate on the /club door only.
 * Unauthenticated visitors go to `/login` — never the seed board
 * and never PersistedClub. `/demo` is the hidden public seed.
 * Only marked admin accounts stay on the council board.
 * Everyone else is sent to the member forum at `/members`.
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
  const me = useQuery(api.club.getMyRole);

  useEffect(() => {
    if (me && me.role !== "admin") {
      router.replace(MEMBER_HOME);
    }
  }, [me, router]);

  if (me === undefined) {
    return <p className="p-8 text-sm text-muted">Checking session…</p>;
  }

  if (me === null) {
    return <ClubSignInRedirect />;
  }

  if (me.role !== "admin") {
    return <p className="p-8 text-sm text-muted">Redirecting…</p>;
  }

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
