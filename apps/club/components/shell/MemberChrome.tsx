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
  retainPanes = false,
  membersPane,
  keyboardNav = false,
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
  /** Public demo label. Omitted on the signed-in shell. */
  notice?: ReactNode;
  /** Controlled pane for `/demo` hashes. Omitted, the shell keeps its own pane. */
  pane?: ShellPane;
  onPaneChange?: (id: ShellPane) => void;
  /**
   * Public demo keeps every pane mounted so one render includes each screen.
   * The signed-in shell leaves this off and shows one pane.
   */
  retainPanes?: boolean;
  /** Public demo directory. Omitted, the signed-in list is `MemberList`. */
  membersPane?: ReactNode;
  /** Arrow keys move the public demo's nav. Off for the signed-in shell. */
  keyboardNav?: boolean;
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
  const directory = membersPane ?? <MemberList members={members} loading={membersLoading} />;

  const body = retainPanes ? (
    <>
      {council ? <div className={pane === "council" ? "h-full" : "hidden"}>{council}</div> : null}
      <div className={pane === "forum" ? undefined : "hidden"}>
        <Forum posts={posts} loading={loading} busy={busy} onPost={onPost} />
      </div>
      <div className={pane === "referral" ? undefined : "hidden"}>{referral}</div>
      <div className={pane === "members" ? undefined : "hidden"}>{directory}</div>
      <div className={pane === "evaluations" ? undefined : "hidden"}>{feedback}</div>
      <div className={pane === "events" ? "px-6 py-16" : "hidden"}>
        <EmptyState title="No upcoming events.">Club events will list here.</EmptyState>
      </div>
    </>
  ) : (
    <>
      {pane === "council" ? council : null}
      {pane === "forum" ? (
        <Forum posts={posts} loading={loading} busy={busy} onPost={onPost} />
      ) : null}
      {pane === "referral" ? referral : null}
      {pane === "members" ? directory : null}
      {pane === "evaluations" ? feedback : null}
      {pane === "events" ? (
        <div className="px-6 py-16">
          <EmptyState title="No upcoming events.">Club events will list here.</EmptyState>
        </div>
      ) : null}
    </>
  );

  return (
    <SignedInShell
      navLabel={clubRole === "admin" ? "Admin" : "Member"}
      items={items}
      activeId={pane}
      onSelect={(id) => selectPane(id as ShellPane)}
      title={title}
      notice={notice}
      keyboardNav={keyboardNav}
      onSignOut={onSignOut}
    >
      {body}
    </SignedInShell>
  );
}
