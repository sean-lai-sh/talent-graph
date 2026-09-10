"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { convexConfigured } from "@/lib/convexEnv";
import { PersistedClub } from "./PersistedClub";

/**
 * Official Better Auth + Convex gate on the /club door only.
 * Unauthenticated visitors get the sign-in UI — never the seed board
 * and never PersistedClub. `/` and `/example` stay public.
 */
export function ClubShell() {
  const configured = convexConfigured();

  return (
    <main className="min-h-screen bg-paper px-6 py-16 text-ink">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Talent Graph · your club</p>
      <h1 className="mt-2 font-serif text-3xl tracking-tight">Club door</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        Signed-in owners use this door. Convex + Better Auth is the official{" "}
        <code className="font-mono text-[12px]">@convex-dev/better-auth</code> integration. Members,
        referrals, and status persist in Convex; views are computed by{" "}
        <code className="font-mono text-[12px]">src/</code>. The public example stays open at{" "}
        <Link className="underline decoration-line underline-offset-2 hover:text-ink" href="/">
          /
        </Link>{" "}
        and{" "}
        <Link
          className="underline decoration-line underline-offset-2 hover:text-ink"
          href="/example"
        >
          /example
        </Link>
        . No sign-in there.
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
    <section className="mt-8 max-w-md rounded-lg border border-line bg-panel p-5">
      <p className="text-sm">
        Signed in as <span className="font-medium">{user?.email ?? "owner"}</span>
      </p>
      <button
        className="mt-4 rounded border border-line px-3 py-1.5 text-sm hover:bg-paper"
        type="button"
        onClick={() => void authClient.signOut()}
      >
        Sign out
      </button>
    </section>
  );
}

function ClubSignInForm() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setMessage(result.error.message ?? "Better Auth could not complete that.");
      return;
    }
    setMessage(mode === "sign-up" ? "Account created." : "Signed in.");
  }

  return (
    <form
      className="mt-8 flex max-w-md flex-col gap-3 rounded-lg border border-line bg-panel p-5"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted">
        Sign in to open your club. This is not the public example.
      </p>
      <div className="flex gap-3 text-sm">
        <button
          className={mode === "sign-in" ? "underline" : "text-muted"}
          type="button"
          onClick={() => setMode("sign-in")}
        >
          Sign in
        </button>
        <button
          className={mode === "sign-up" ? "underline" : "text-muted"}
          type="button"
          onClick={() => setMode("sign-up")}
        >
          Create account
        </button>
      </div>
      {mode === "sign-up" ? (
        <label className="text-sm">
          Name
          <input
            className="mt-1 w-full rounded border border-line bg-paper px-2 py-1.5"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
        </label>
      ) : null}
      <label className="text-sm">
        Email
        <input
          className="mt-1 w-full rounded border border-line bg-paper px-2 py-1.5"
          name="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </label>
      <label className="text-sm">
        Password
        <input
          className="mt-1 w-full rounded border border-line bg-paper px-2 py-1.5"
          name="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
        />
      </label>
      <button
        className="rounded bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-50"
        type="submit"
        disabled={pending}
      >
        {pending ? "Working…" : mode === "sign-up" ? "Create account" : "Sign in"}
      </button>
      {message ? <p className="text-sm text-warn">{message}</p> : null}
    </form>
  );
}
