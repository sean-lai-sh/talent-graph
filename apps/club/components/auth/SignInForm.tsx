"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { destAfterLogin, resolveRole } from "@/lib/clubRole.ts";
import { convexConfigured } from "@/lib/convexEnv";
import { clubLoginHref } from "@/lib/loginReturnPath.ts";

/**
 * Email/password sign-in only. Public signup is disabled in Better Auth
 * (`disableSignUp: true`). Owners are provisioned out of band.
 * A live session returns to `/login`, which sends admins to `/club` and
 * members to `/members` on the server. Without Convex, `destAfterLogin`
 * still picks a path from the email alone.
 */
export function SignInForm({ nextHref = "/club" }: { nextHref?: string }) {
  const router = useRouter();
  const live = convexConfigured();
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
    if (live) {
      window.location.assign(clubLoginHref(nextHref));
      return;
    }
    setPending(false);
    router.push(destAfterLogin(nextHref, resolveRole({ email })));
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
