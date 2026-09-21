"use client";

import { useState } from "react";
import type { ForumPost } from "../../../components/forum/Forum.tsx";
import { MemberChrome } from "../../../components/shell/MemberChrome.tsx";

/** Hidden `/demo/home` preview — local posts, no Convex. */
export function MemberHomePreview() {
  const [posts, setPosts] = useState<ForumPost[]>([]);

  return (
    <MemberChrome
      posts={posts}
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
