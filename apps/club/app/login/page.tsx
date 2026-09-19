import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/SignInForm.tsx";
import "../landing.css";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/** Email/password only. No create-account path. */
export default function LoginPage() {
  return (
    <main className="login">
      <SignInForm />
    </main>
  );
}
