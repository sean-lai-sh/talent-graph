import type { Metadata } from "next";
import { RoleHomeRedirect } from "@/components/auth/RoleHomeRedirect.tsx";
import { SignInForm } from "@/components/auth/SignInForm.tsx";
import { hasClubSession } from "@/lib/clubSession.ts";
import { safeReturnPath } from "@/lib/loginReturnPath.ts";
import "../landing.css";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Email/password only. No create-account path. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  if (await hasClubSession()) {
    return (
      <main className="login">
        <RoleHomeRedirect nextHref={next} />
      </main>
    );
  }

  return (
    <main className="login">
      <SignInForm nextHref={next} />
    </main>
  );
}
