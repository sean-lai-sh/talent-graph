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
  feedback,
  feedbackCount = 0,
  notice,
  pane: paneProp,
  onPaneChange,
  memberEmpty,
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
  feedback: ReactNode;
  feedbackCount?: number;
  notice?: ReactNode;
  pane?: ShellPane;
  onPaneChange?: (id: ShellPane) => void;
  /** Replacement for a blank directory cell. The signed-in list keeps an em dash. */
  memberEmpty?: string;
}) {
  const [uncontrolledPane, setUncontrolledPane] = useState<ShellPane>(
    clubRole === "admin" ? "council" : "forum",
  );
  const pane = paneProp ?? uncontrolledPane;
  const selectPane = (id: ShellPane) => {
    onPaneChange?.(id);
    if (paneProp === undefined) setUncontrolledPane(id);
  };
  const items = navForRole(clubRole).map((item) => {
    if (item.id === "members") return { ...item, count: members.length };
    if (item.id === "evaluations") return { ...item, count: feedbackCount };
    return item;
  });
  const title = pane === "council" ? "Council" : TITLES[pane];

  return (
    <SignedInShell
      navLabel={clubRole === "admin" ? "Admin" : "Member"}
      items={items}
      activeId={pane}
      onSelect={(id) => selectPane(id as ShellPane)}
      title={title}
      notice={notice}
      onSignOut={onSignOut}
    >
      {council ? <div className={pane === "council" ? "h-full" : "hidden"}>{council}</div> : null}
      <div className={pane === "forum" ? undefined : "hidden"}>
        <Forum posts={posts} loading={loading} busy={busy} onPost={onPost} />
      </div>
      <div className={pane === "referral" ? undefined : "hidden"}>{referral}</div>
      <div className={pane === "members" ? undefined : "hidden"}>
        <MemberList members={members} loading={membersLoading} empty={memberEmpty} />
      </div>
      <div className={pane === "evaluations" ? undefined : "hidden"}>{feedback}</div>
      <div className={pane === "events" ? "px-6 py-16" : "hidden"}>
        <EmptyState title="No upcoming events.">Club events will list here.</EmptyState>
      </div>
    </SignedInShell>
  );
}
