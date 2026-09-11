import { ClubLab } from "../../../components/ClubLab.tsx";
import { loadClub } from "../../../lib/engine.ts";

export const dynamic = "force-dynamic";

/** Compare, judge clock, and referral graph for the public example. */
export default function ExampleLabDoor() {
  const initial = loadClub();
  return <ClubLab initial={initial} />;
}
