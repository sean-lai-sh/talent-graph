"use client";

import { useState } from "react";
import type { ForumPost } from "../../../components/forum/Forum.tsx";
import { AdminChrome } from "../../../components/shell/AdminChrome.tsx";
import { EmptyState } from "../../../components/ui/EmptyState.tsx";

/** Hidden `/demo/home` preview — local posts, no Convex, no council board. */
export function AdminHomePreview() {
  const [posts, setPosts] = useState<ForumPost[]>([]);

  return (
    <AdminChrome
      posts={posts}
      onPost={(body) => {
        setPosts((current) => [
          {
            id: `preview-${Date.now()}`,
            body,
            authorName: "Admin",
            createdAt: new Date().toISOString(),
          },
          ...current,
        ]);
      }}
      review={
        <div className="px-6 py-16">
          <EmptyState title="Review is the council board.">
            Open <span className="text-ink">/demo</span> for the public seed, or sign in on{" "}
            <span className="text-ink">/club</span> for the live queue.
          </EmptyState>
        </div>
      }
    />
  );
}
