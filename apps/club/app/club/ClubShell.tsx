"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import Link from "next/link";
import { SignInForm } from "@/components/auth/SignInForm.tsx";
import { Button } from "@/components/ui/index.ts";
import { authClient } from "@/lib/auth-client";
import { convexConfigured } from "@/lib/convexEnv";
import { PersistedClub } from "./PersistedClub";

/**
 * Official Better Auth + Convex gate on the /club door only.
 * Unauthenticated visitors get the sign-in UI — never the seed board
 * and never PersistedClub. `/demo` is the hidden public seed.
 */
export function ClubShell() {
  const configured = convexConfigured();

  return (
    <main className="min-h-screen bg-canvas px-6 py-16 text-ink">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Talent Graph · your club</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Club door</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        Signed-in owners use this door. The council review page persists here. Convex + Better Auth
        is the official <code className="font-mono text-[12px]">@convex-dev/better-auth</code>{" "}
        integration. Members, referrals, and status persist in Convex; views are computed by{" "}
        <code className="font-mono text-[12px]">src/</code>. Sign-in is email and password. There is
        no create-account path — an admin provisions owners. The public landing is{" "}
        <Link className="underline decoration-line underline-offset-2 hover:text-ink" href="/">
          /
        </Link>
        .
      </p>
      {!configured ? (
        <>
          <p className="mt-4 max-w-xl text-sm text-warn">
            Convex is not connected yet. The board stays closed. Set the{" "}
            <code className="font-mono">NEXT_PUBLIC_CONVEX_URL</code>,{" "}
            <code className="font-mono">NEXT_PUBLIC_CONVEX_SITE_URL</code>, and{" "}
            <code className="font-mono">NEXT_PUBLIC_SITE_URL</code> values from{" "}
            <code className="font-mono">apps/club/.env.example</code>, then run{" "}
            <code className="font-mono">npx convex dev</code> in{" "}
            <code className="font-mono">apps/club</code> and set{" "}
            <code className="font-mono">BETTER_AUTH_SECRET</code> and{" "}
            <code className="font-mono">SITE_URL</code> on the Convex deployment.
          </p>
          <ClubSignInForm />
        </>
      ) : (
        <>
          <AuthLoading>
            <p className="mt-8 text-sm text-muted">Checking session…</p>
          </AuthLoading>
          <Unauthenticated>
            <ClubSignInForm />
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

function ClubSignInForm() {
  return <SignInForm />;
}
