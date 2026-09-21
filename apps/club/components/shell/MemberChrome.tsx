"use client";

import { useState } from "react";
import type { DirectoryMember } from "../../lib/memberDirectory.ts";
import { Forum, type ForumPost } from "../forum/Forum.tsx";
import { MemberList } from "../members/MemberList.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { SignedInShell } from "./SignedInShell.tsx";

export const MEMBER_NAV = [
  { id: "forum", label: "Forum" },
  { id: "referral", label: "Submit Referral" },
  { id: "members", label: "Member List" },
  { id: "evaluations", label: "Evaluations", count: 0 },
  { id: "events", label: "Upcoming Events" },
] as const;

export type MemberPane = (typeof MEMBER_NAV)[number]["id"];

const TITLES: Record<MemberPane, string> = {
  forum: "Forum",
  referral: "Submit Referral",
  members: "Member List",
  evaluations: "Evaluations",
  events: "Upcoming Events",
};

/** Member wireframe: sidebar actions, forum as the main pane. */
export function MemberChrome({
  posts,
  members = [],
  loading = false,
  membersLoading = false,
  busy = false,
  onPost,
  onSignOut,
}: {
  posts: ForumPost[];
  members?: DirectoryMember[];
  loading?: boolean;
  membersLoading?: boolean;
  busy?: boolean;
  onPost: (body: string) => void;
  onSignOut?: () => void;
}) {
  const [pane, setPane] = useState<MemberPane>("forum");
  const items = MEMBER_NAV.map((item) =>
    item.id === "members" ? { ...item, count: members.length } : item,
  );

  return (
    <SignedInShell
      navLabel="Member"
      items={items}
      activeId={pane}
      onSelect={(id) => setPane(id as MemberPane)}
      title={TITLES[pane]}
      onSignOut={onSignOut}
    >
      {pane === "forum" ? (
        <Forum posts={posts} loading={loading} busy={busy} onPost={onPost} />
      ) : null}
      {pane === "referral" ? (
        <div className="px-6 py-16">
          <EmptyState title="Referral form lands here.">
            Members will submit people from this pane.
          </EmptyState>
        </div>
      ) : null}
      {pane === "members" ? <MemberList members={members} loading={membersLoading} /> : null}
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
