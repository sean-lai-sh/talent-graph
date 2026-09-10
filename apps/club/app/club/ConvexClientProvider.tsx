"use client";

import { type AuthClient, ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { type ReactNode, useMemo } from "react";
import { authClient } from "@/lib/auth-client";
import { convexConfigured } from "@/lib/convexEnv";

// Official ConvexBetterAuthProvider AuthClient type is a plugin union; the
// documented createAuthClient({ plugins: [convexClient()] }) client overlaps it.
const clubAuthClient = authClient as unknown as AuthClient;

export function ConvexClientProvider({
  children,
  initialToken,
}: {
  children: ReactNode;
  initialToken?: string | null;
}) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const configured = convexConfigured();
  const client = useMemo(
    () => (configured && convexUrl ? new ConvexReactClient(convexUrl) : null),
    [configured, convexUrl],
  );

  if (!client) {
    return children;
  }

  return (
    <ConvexBetterAuthProvider
      client={client}
      authClient={clubAuthClient}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}
