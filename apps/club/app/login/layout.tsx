import type { ReactNode } from "react";
import { getToken } from "@/lib/auth-server";
import { convexConfigured } from "@/lib/convexEnv";
import { ConvexClientProvider } from "../club/ConvexClientProvider";

export const dynamic = "force-dynamic";

export default async function LoginLayout({ children }: { children: ReactNode }) {
  const configured = convexConfigured();
  const token = configured ? await getToken() : null;
  return <ConvexClientProvider initialToken={token}>{children}</ConvexClientProvider>;
}
