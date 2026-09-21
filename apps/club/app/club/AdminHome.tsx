"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { AdminChrome } from "../../components/shell/AdminChrome.tsx";
import { api } from "../../convex/_generated/api";
import { PersistedClub } from "./PersistedClub";

/**
 * Admin landing for the owner test account. Same chrome as the member
 * wireframe; the main pane is a forum you just post into. Review still
 * opens the Convex council board.
 */
export function AdminHome({ onSignOut }: { onSignOut: () => void }) {
  const posts = useQuery(api.club.listPosts);
  const addPost = useMutation(api.club.addPost);
  const [busy, setBusy] = useState(false);

  return (
    <AdminChrome
      posts={posts ?? []}
      loading={posts === undefined}
      busy={busy}
      onPost={(body) => {
        setBusy(true);
        void addPost({ body }).finally(() => setBusy(false));
      }}
      onSignOut={onSignOut}
      review={<PersistedClub />}
    />
  );
}
