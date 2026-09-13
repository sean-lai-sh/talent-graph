"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button, Field, Input } from "@/components/ui/index.ts";
import { authClient } from "@/lib/auth-client";
import { safeReturnPath } from "@/lib/loginReturnPath.ts";

export function LoginCard({ next }: { next: string }) {
  const router = useRouter();
  const dest = safeReturnPath(next);
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
    router.replace(dest);
  }

  return (
    <form
      className="w-full max-w-md rounded-lg border border-line bg-surface p-5"
      onSubmit={(event) => void onSubmit(event)}
    >
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
        <Field className="mt-3" label="Name">
          <Input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
        </Field>
      ) : null}
      <Field className="mt-3" label="Email">
        <Input
          name="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </Field>
      <Field className="mt-3" label="Password">
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
        />
      </Field>
      <Button className="mt-4 w-full" type="submit" variant="primary" disabled={pending}>
        {pending ? "Working…" : mode === "sign-up" ? "Create account" : "Sign in"}
      </Button>
      {message ? <p className="mt-3 text-sm text-warn">{message}</p> : null}
    </form>
  );
}
