import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasClubSession } from "@/lib/clubSession.ts";
import { safeReturnPath } from "@/lib/loginReturnPath.ts";
import { LoginCard } from "./LoginCard";

export const metadata: Metadata = {
  title: "Sign in",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  if (await hasClubSession()) {
    redirect(next);
  }

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <LoginCard next={next} />
    </main>
  );
}
