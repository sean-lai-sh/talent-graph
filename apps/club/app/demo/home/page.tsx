import type { Metadata } from "next";
import { AdminHomePreview } from "./AdminHomePreview.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Talent Graph · admin home",
};

/**
 * Hidden public preview of the admin landing chrome + local forum.
 * Not linked from `/`. Live persist is `/club` after sign-in.
 */
export default function HiddenAdminHome() {
  return <AdminHomePreview />;
}
