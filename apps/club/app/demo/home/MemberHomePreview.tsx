"use client";

import { useState } from "react";
import type { ForumPost } from "../../../components/forum/Forum.tsx";
import { MemberChrome } from "../../../components/shell/MemberChrome.tsx";
import { exampleDirectory, exampleForumPost } from "../../../lib/exampleDemo.ts";
import { DemoEvaluations } from "../DemoEvaluations.tsx";
import { DemoMemberList } from "../DemoMemberList.tsx";
import { DemoReferral } from "../DemoReferral.tsx";
import { ExampleNote } from "../ExampleNote.tsx";

/** Hidden `/demo/home` preview — local posts, fixture directory, no Convex. */
export function MemberHomePreview() {
  const members = exampleDirectory();
  const author = exampleForumPost().authorName;
  const [posts, setPosts] = useState<ForumPost[]>(() => [exampleForumPost()]);

  return (
    <MemberChrome
      notice={<ExampleNote />}
      retainPanes
      keyboardNav
      posts={posts}
      members={members}
      membersPane={<DemoMemberList />}
      onPost={(body) => {
        setPosts((current) => [
          {
            id: `preview-${current.length}`,
            body,
            authorName: author,
            createdAt: new Date().toISOString(),
          },
          ...current,
        ]);
      }}
      referral={<DemoReferral />}
      feedback={<DemoEvaluations />}
    />
  );
}
