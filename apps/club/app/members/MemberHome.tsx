"use client";

import { useState } from "react";
import { SignedInShell } from "../../components/shell/SignedInShell.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";

const MEMBER_NAV = [
  { id: "referral", label: "Submit Referral" },
  { id: "evaluations", label: "Evaluations", count: 0 },
  { id: "events", label: "Upcoming Events" },
] as const;

type MemberPane = (typeof MEMBER_NAV)[number]["id"];

const TITLES: Record<MemberPane, string> = {
  referral: "Submit Referral",
  evaluations: "Evaluations",
  events: "Upcoming Events",
};

/**
 * Member home matching the sidebar wireframe. Sign-out sits in the top
 * bar. Referral / inbox flows come later.
 */
export function MemberHome({ onSignOut }: { onSignOut: () => void }) {
  const [pane, setPane] = useState<MemberPane>("referral");

  return (
    <SignedInShell
      navLabel="Member"
      items={MEMBER_NAV}
      activeId={pane}
      onSelect={(id) => setPane(id as MemberPane)}
      title={TITLES[pane]}
      onSignOut={onSignOut}
    >
      {pane === "referral" ? (
        <div className="px-6 py-16">
          <EmptyState title="Referral form lands here.">
            Members will submit people from this pane. The admin forum and Review stay on /club.
          </EmptyState>
        </div>
      ) : null}
      {pane === "evaluations" ? (
        <div className="px-6 py-16">
          <EmptyState title="No evaluations waiting.">
            Asked responses will show a count on Evaluations.
          </EmptyState>
        </div>
      ) : null}
      {pane === "events" ? (
        <div className="px-6 py-16">
          <EmptyState title="No upcoming events.">Club events will list here.</EmptyState>
        </div>
      ) : null}
    </SignedInShell>
  );
}
