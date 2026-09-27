import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RoleHomeRedirect } from "@/components/auth/RoleHomeRedirect.tsx";
import { SignInForm } from "@/components/auth/SignInForm.tsx";
import { doorAfterLogin } from "@/lib/clubRole.ts";
import { hasClubSession, readSessionRole } from "@/lib/clubSession.ts";
import { safeReturnPath } from "@/lib/loginReturnPath.ts";
import "../landing.css";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Email/password only. No create-account path.
 * A signed-in visit is the one door: the server reads the role and
 * redirects before this page renders. RoleHomeRedirect remains when
 * that read fails.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  if (await hasClubSession()) {
    const dest = doorAfterLogin(next, await readSessionRole());
    if (dest) redirect(dest);
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
