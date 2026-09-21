import { redirect } from "next/navigation";
import { hasClubSession } from "@/lib/clubSession.ts";
import { clubLoginHref } from "@/lib/loginReturnPath.ts";
import { MemberShell } from "./MemberShell";

/**
 * Member home. Unauthenticated visitors redirect to `/login`.
 * The public seed stays on `/demo`.
 */
export default async function MembersDoor() {
  if (!(await hasClubSession())) {
    redirect(clubLoginHref("/members"));
  }
  return <MemberShell />;
}
