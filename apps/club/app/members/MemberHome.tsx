"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { MemberChrome } from "../../components/shell/MemberChrome.tsx";
import { api } from "../../convex/_generated/api";

/**
 * Member home: sidebar from the wireframe, forum in the main pane.
 * Sign-out sits in the top bar.
 */
export function MemberHome({ onSignOut }: { onSignOut: () => void }) {
  const posts = useQuery(api.club.listPosts);
  const addPost = useMutation(api.club.addPost);
  const [busy, setBusy] = useState(false);

  return (
    <MemberChrome
      posts={posts ?? []}
      loading={posts === undefined}
      busy={busy}
      onPost={(body) => {
        setBusy(true);
        void addPost({ body }).finally(() => setBusy(false));
      }}
      onSignOut={onSignOut}
    />
  );
}
