"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/index.ts";
import { authClient } from "@/lib/auth-client";
import { clubLoginHref, SIGN_OUT_HREF } from "@/lib/loginReturnPath.ts";
import { PersistedClub } from "./PersistedClub";

export function ClubShell() {
  return (
    <main className="min-h-screen bg-canvas px-6 py-16 text-ink">
      <AuthLoading>
        <p className="mt-8 text-sm text-muted">Checking session…</p>
      </AuthLoading>
      <Unauthenticated>
        <RedirectToLogin />
      </Unauthenticated>
      <Authenticated>
        <ClubSignedInBar />
        <PersistedClub />
      </Authenticated>
    </main>
  );
}

function RedirectToLogin() {
  const router = useRouter();

  useEffect(() => {
    router.replace(clubLoginHref("/club"));
  }, [router]);

  return <p className="mt-8 text-sm text-muted">Redirecting to sign in…</p>;
}

function ClubSignedInBar() {
  const session = authClient.useSession();
  const user = session.data?.user;
  const router = useRouter();

  return (
    <section className="mt-8 max-w-md rounded-lg border border-line bg-surface p-5">
      <p className="text-sm">
        Signed in as <span className="font-medium">{user?.email ?? "owner"}</span>
      </p>
      <Button
        className="mt-4"
        type="button"
        onClick={() => {
          void authClient.signOut().then(() => {
            router.replace(SIGN_OUT_HREF);
          });
        }}
      >
        Sign out
      </Button>
    </section>
  );
}
