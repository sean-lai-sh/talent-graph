"use client";

import { Field, Input } from "../../components/ui/index.ts";

/**
 * Presentational referral step for `/demo`.
 * The signed-in form stays in `ReferralSignup.tsx`. This copy does not import it,
 * Convex, or the scoring engine.
 */
export function DemoReferral() {
  return (
    <form className="mx-auto max-w-md px-6 py-10" onSubmit={(event) => event.preventDefault()}>
      <Field label="Email or phone" hint="Lookup uses this contact, never a name.">
        <Input name="contact" autoComplete="off" placeholder="name@example.test" />
      </Field>
    </form>
  );
}
