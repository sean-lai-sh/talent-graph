"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { ClubRole } from "../../lib/clubRole.ts";
import type { DirectoryMember } from "../../lib/memberDirectory.ts";
import { type MemberPane, navForRole, type ShellPane } from "../../lib/shellNav.ts";
import { Forum, type ForumPost } from "../forum/Forum.tsx";
import { MemberList } from "../members/MemberList.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { SignedInShell } from "./SignedInShell.tsx";

const TITLES: Record<MemberPane, string> = {
  forum: "Forum",
  referral: "Submit Referral",
  members: "Member List",
  evaluations: "Evaluations",
  events: "Upcoming Events",
};

/** Shared signed-in chrome. Sidebar items come from the role. */
export function MemberChrome({
  clubRole = "member",
  posts,
  members = [],
  loading = false,
  membersLoading = false,
  busy = false,
  onPost,
  onSignOut,
  council,
  referral,
}: {
  clubRole?: ClubRole;
  posts: ForumPost[];
  members?: DirectoryMember[];
  loading?: boolean;
  membersLoading?: boolean;
  busy?: boolean;
  onPost: (body: string) => void;
  onSignOut?: () => void;
  council?: ReactNode;
  referral: ReactNode;
}) {
  const [pane, setPane] = useState<ShellPane>(clubRole === "admin" ? "council" : "forum");
  const items = navForRole(clubRole).map((item) =>
    item.id === "members" ? { ...item, count: members.length } : item,
  );
  const title = pane === "council" ? "Council" : TITLES[pane];

  return (
    <SignedInShell
      navLabel={clubRole === "admin" ? "Admin" : "Member"}
      items={items}
      activeId={pane}
      onSelect={(id) => setPane(id as ShellPane)}
      title={title}
      onSignOut={onSignOut}
    >
      {pane === "council" ? council : null}
      {pane === "forum" ? (
        <Forum posts={posts} loading={loading} busy={busy} onPost={onPost} />
      ) : null}
      {pane === "referral" ? referral : null}
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
