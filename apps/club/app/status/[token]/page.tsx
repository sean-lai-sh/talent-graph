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
  if (!url || token.length === 0) return null;
  try {
    const client = new ConvexHttpClient(url);
    const result = await client.query(api.referral.referralStatus, { token });
    return result?.line ?? null;
  } catch {
    return null;
  }
}

export default async function ReferralStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let decoded = token;
  try {
    decoded = decodeURIComponent(token);
  } catch {
    decoded = "";
  }
  const line = await loadLine(decoded);
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <p className="text-sm text-ink">{line ?? "Not found."}</p>
    </main>
  );
}
