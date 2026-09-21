"use client";

import { useMemo, useState } from "react";
import type { ForumPost } from "../../../components/forum/Forum.tsx";
import { MemberChrome } from "../../../components/shell/MemberChrome.tsx";
import { initialState } from "../../../lib/engine.ts";
import { toDirectoryMembers } from "../../../lib/memberDirectory.ts";

/** Hidden `/demo/home` preview — local posts, seed member directory, no Convex. */
export function MemberHomePreview() {
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const members = useMemo(() => toDirectoryMembers(initialState().people), []);

  return (
    <MemberChrome
      posts={posts}
      members={members}
      onPost={(body) => {
        setPosts((current) => [
          {
            id: `preview-${Date.now()}`,
            body,
            authorName: "Member",
            createdAt: new Date().toISOString(),
          },
          ...current,
        ]);
      }}
    />
  );
}
