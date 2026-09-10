import type { ReactNode } from "react";
import { getToken } from "@/lib/auth-server";
import { ConvexClientProvider } from "./ConvexClientProvider";

export const dynamic = "force-dynamic";

export default async function ClubLayout({ children }: { children: ReactNode }) {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_CONVEX_URL && process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
  );
  const token = configured ? await getToken() : null;
  return <ConvexClientProvider initialToken={token}>{children}</ConvexClientProvider>;
}
