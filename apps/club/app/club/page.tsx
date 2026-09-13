import { redirect } from "next/navigation";
import { hasClubSession } from "@/lib/clubSession.ts";
import { clubLoginHref } from "@/lib/loginReturnPath.ts";
import { ClubShell } from "./ClubShell";

export default async function RealClubDoor() {
  if (!(await hasClubSession())) {
    redirect(clubLoginHref("/club"));
  }
  return <ClubShell />;
}
