"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { MemberChrome } from "../../components/shell/MemberChrome.tsx";
import { api } from "../../convex/_generated/api";

/**
 * Member home for non-admin accounts: sidebar from the wireframe,
 * shared forum in the main pane. Sign-out sits in the top bar.
 */
export function MemberHome({ onSignOut }: { onSignOut: () => void }) {
  const posts = useQuery(api.club.listPosts);
  const members = useQuery(api.club.listMembers);
  const addPost = useMutation(api.club.addPost);
  const [busy, setBusy] = useState(false);

  return (
    <MemberChrome
      posts={posts ?? []}
      members={members ?? []}
      loading={posts === undefined}
      membersLoading={members === undefined}
      busy={busy}
      onPost={(body) => {
        setBusy(true);
        void addPost({ body }).finally(() => setBusy(false));
      }}
      onSignOut={onSignOut}
    />
  );
}
