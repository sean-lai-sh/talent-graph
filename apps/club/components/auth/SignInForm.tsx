"use client";

import { useConvex } from "convex/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { type ClubRole, destAfterLogin, resolveRole } from "@/lib/clubRole.ts";
import { convexConfigured } from "@/lib/convexEnv";
import { api } from "../../convex/_generated/api";

/**
 * Email/password sign-in only. Public signup is disabled in Better Auth
 * (`disableSignUp: true`). Owners are provisioned out of band.
 * After a session lands, unmarked accounts go to `/members`.
 */
export function SignInForm({ nextHref = "/club" }: { nextHref?: string }) {
  return convexConfigured() ? (
    <SignInFormLive nextHref={nextHref} />
  ) : (
    <SignInFormFields nextHref={nextHref} />
  );
}

function SignInFormLive({ nextHref }: { nextHref: string }) {
  const convex = useConvex();
  return (
    <SignInFormFields
      nextHref={nextHref}
      resolveDest={async (email) => {
        const role = await roleFromSession(convex, email);
        return destAfterLogin(nextHref, role);
      }}
    />
  );
}

async function roleFromSession(
  convex: { query: ReturnType<typeof useConvex>["query"] },
  email: string,
): Promise<ClubRole> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const me = await convex.query(api.club.getMyRole);
      if (me?.role) return me.role;
    } catch {
      // Session token may not be on the Convex client yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return resolveRole({ email });
}

function SignInFormFields({
  nextHref,
  resolveDest,
}: {
  nextHref: string;
  resolveDest?: (email: string) => Promise<string>;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      setPending(false);
      setMessage(result.error.message ?? "Could not sign in.");
      return;
    }
    const dest = resolveDest
      ? await resolveDest(email)
      : destAfterLogin(nextHref, resolveRole({ email }));
    setPending(false);
    router.push(dest);
    router.refresh();
  }

  return (
    <form className="login-form" onSubmit={(event) => void onSubmit(event)}>
      <h1>Sign in</h1>
      <label className="login-field">
        Email
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="login-field">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
