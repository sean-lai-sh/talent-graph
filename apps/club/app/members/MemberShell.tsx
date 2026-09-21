"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { convexConfigured } from "@/lib/convexEnv";
import { clubLoginHref, SIGN_OUT_HREF } from "@/lib/loginReturnPath.ts";
import { MemberHome } from "./MemberHome";

/**
 * Member door. Same Better Auth gate as /club. Unauthenticated visitors
 * go to `/login`. No identity card in the chrome.
 */
export function MemberShell() {
  const configured = convexConfigured();

  return (
    <div className="bg-canvas text-ink">
      {!configured ? (
        <MemberSignInRedirect />
      ) : (
        <>
          <AuthLoading>
            <p className="p-8 text-sm text-muted">Checking session…</p>
          </AuthLoading>
          <Unauthenticated>
            <MemberSignInRedirect />
          </Unauthenticated>
          <Authenticated>
            <MemberSignedIn />
          </Authenticated>
        </>
      )}
    </div>
  );
}

function MemberSignedIn() {
  const router = useRouter();
  return (
    <MemberHome
      onSignOut={() => {
        void authClient.signOut().then(() => {
          router.replace(SIGN_OUT_HREF);
        });
      }}
    />
  );
}

function MemberSignInRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(clubLoginHref("/members"));
  }, [router]);
  return <p className="p-8 text-sm text-muted">Redirecting to sign in…</p>;
}
