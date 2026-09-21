"use client";

import { type ReactNode, useState } from "react";
import { Forum, type ForumPost } from "../forum/Forum.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { SignedInShell } from "./SignedInShell.tsx";

export const ADMIN_NAV = [
  { id: "forum", label: "Forum" },
  { id: "review", label: "Review" },
  { id: "evaluations", label: "Evaluations" },
  { id: "events", label: "Events" },
] as const;

export type AdminPane = (typeof ADMIN_NAV)[number]["id"];

const TITLES: Record<AdminPane, string> = {
  forum: "Forum",
  review: "Review",
  evaluations: "Evaluations",
  events: "Events",
};

/** Sidebar + forum / review / stubs. No Convex, no council board. */
export function AdminChrome({
  posts,
  loading = false,
  busy = false,
  onPost,
  onSignOut,
  review,
}: {
  posts: ForumPost[];
  loading?: boolean;
  busy?: boolean;
  onPost: (body: string) => void;
  onSignOut?: () => void;
  review: ReactNode;
}) {
  const [pane, setPane] = useState<AdminPane>("forum");

  return (
    <SignedInShell
      navLabel="Admin"
      items={ADMIN_NAV}
      activeId={pane}
      onSelect={(id) => setPane(id as AdminPane)}
      title={TITLES[pane]}
      onSignOut={onSignOut}
    >
      {pane === "forum" ? (
        <Forum posts={posts} loading={loading} busy={busy} onPost={onPost} />
      ) : null}
      {pane === "review" ? review : null}
      {pane === "evaluations" ? (
        <div className="px-6 py-16">
          <EmptyState title="No evaluations in this pane yet.">
            Pending member responses still live on each case in Review.
          </EmptyState>
        </div>
      ) : null}
      {pane === "events" ? (
        <div className="px-6 py-16">
          <EmptyState title="No upcoming events.">Events you add will land here.</EmptyState>
        </div>
      ) : null}
    </SignedInShell>
  );
}
