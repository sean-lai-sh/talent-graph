import type { Metadata } from "next";
import { MemberHomePreview } from "./MemberHomePreview.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Talent Graph · member home",
};

/**
 * Hidden public preview of the member chrome, local forum, and the
 * static example fixture. Not linked from `/`. Live persist is
 * `/members` after sign-in. No Convex query.
 */
export default function HiddenMemberHome() {
  return <MemberHomePreview />;
}
