"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Email/password sign-in only. Public signup is disabled in Better Auth
 * (`disableSignUp: true`). Owners are provisioned out of band.
 */
export function SignInForm({ nextHref = "/club" }: { nextHref?: string }) {
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
    setPending(false);
    if (result.error) {
      setMessage(result.error.message ?? "Could not sign in.");
      return;
    }
    router.push(nextHref);
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
