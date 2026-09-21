"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { destAfterLogin } from "@/lib/clubRole.ts";
import { clubLoginHref } from "@/lib/loginReturnPath.ts";
import { api } from "../../convex/_generated/api";

/**
 * Already-signed-in visitors: admins keep `/club`, everyone else
 * lands on the member forum.
 */
export function RoleHomeRedirect({ nextHref }: { nextHref: string }) {
  const router = useRouter();
  const me = useQuery(api.club.getMyRole);

  useEffect(() => {
    if (me === undefined) return;
    if (me === null) {
      router.replace(clubLoginHref(nextHref));
      return;
    }
    router.replace(destAfterLogin(nextHref, me.role));
  }, [me, nextHref, router]);

  return <p className="p-8 text-sm text-muted">Redirecting…</p>;
}
