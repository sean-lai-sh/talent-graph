"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/index.ts";
import { authClient } from "@/lib/auth-client";
import { convexConfigured } from "@/lib/convexEnv";
import { PersistedClub } from "./PersistedClub";

/**
 * Official Better Auth + Convex gate on the /club door only.
 * Unauthenticated visitors go to `/login` — never the seed board
 * and never PersistedClub. `/demo` is the hidden public seed.
 */
export function ClubShell() {
  const configured = convexConfigured();

  return (
    <main className="min-h-screen bg-canvas px-6 py-16 text-ink">
      {!configured ? (
        <ClubSignInRedirect />
      ) : (
        <>
          <AuthLoading>
            <p className="mt-8 text-sm text-muted">Checking session…</p>
          </AuthLoading>
          <Unauthenticated>
            <ClubSignInRedirect />
          </Unauthenticated>
          <Authenticated>
            <ClubSignedInBar />
            <PersistedClub />
          </Authenticated>
        </>
      )}
    </main>
  );
}

function ClubSignedInBar() {
  const session = authClient.useSession();
  const user = session.data?.user;

  return (
    <section className="mt-8 max-w-md rounded-lg border border-line bg-surface p-5">
      <p className="text-sm">
        Signed in as <span className="font-medium">{user?.email ?? "owner"}</span>
      </p>
      <Button className="mt-4" type="button" onClick={() => void authClient.signOut()}>
        Sign out
      </Button>
    </section>
  );
}

function ClubSignInRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return <p className="text-sm text-muted">Redirecting to sign in…</p>;
}
