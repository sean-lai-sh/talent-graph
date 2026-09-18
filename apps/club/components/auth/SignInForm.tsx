"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button, Field, Input } from "@/components/ui/index.ts";
import { authClient } from "@/lib/auth-client";

/**
 * Email/password sign-in only. Public signup is disabled in Better Auth
 * (`disableSignUp: true`). Owners are provisioned out of band.
 */
export function SignInForm({
  variant = "club",
  nextHref = "/club",
}: {
  variant?: "club" | "landing";
  nextHref?: string;
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
    setPending(false);
    if (result.error) {
      setMessage(result.error.message ?? "Could not sign in.");
      return;
    }
    router.push(nextHref);
    router.refresh();
  }

  if (variant === "landing") {
    return (
      <form className="landing-auth" onSubmit={(event) => void onSubmit(event)}>
        <p className="landing-auth-lead">Sign in. Accounts are created by an admin.</p>
        <label className="landing-field">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="landing-field">
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

  return (
    <form
      className="mt-8 flex max-w-md flex-col gap-3 rounded-lg border border-line bg-surface p-5"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted">
        Sign in to open your club. There is no create-account path. An admin provisions access.
      </p>
      <Field label="Email">
        <Input
          name="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </Field>
      <Field label="Password">
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </Field>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      {message ? <p className="text-sm text-warn">{message}</p> : null}
    </form>
  );
}
