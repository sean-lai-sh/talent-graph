import { ConvexHttpClient } from "convex/browser";
import type { Metadata } from "next";
import { api } from "@/convex/_generated/api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Status",
  robots: { index: false, follow: false },
};

async function loadLine(token: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  try {
    const result = await new ConvexHttpClient(url).query(api.referral.referralStatus, { token });
    return result?.line ?? null;
  } catch {
    return null;
  }
}

export default async function ReferralStatusPage({ params }: PageProps<"/status/[token]">) {
  const { token } = await params;
  const line = await loadLine(token);
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <p className="text-sm text-ink">{line ?? "Not found."}</p>
    </main>
  );
}
