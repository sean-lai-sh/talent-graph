"use client";

import { useState } from "react";
import { FeedbackInbox } from "../../../components/feedback/FeedbackInbox.tsx";
import type { ForumPost } from "../../../components/forum/Forum.tsx";
import { ReferralSignupPreview } from "../../../components/referral/ReferralSignupForm.tsx";
import { ExampleNote } from "../../../components/shell/ExampleNote.tsx";
import { MemberChrome } from "../../../components/shell/MemberChrome.tsx";
import { UNKNOWN_VALUE } from "../../../lib/copy.ts";
import { exampleDirectory, exampleForumPost } from "../../../lib/exampleDemo.ts";

/** Hidden `/demo/home` preview — local posts, fixture directory, no Convex. */
export function MemberHomePreview() {
  const members = exampleDirectory();
  const author = exampleForumPost().authorName;
  const [posts, setPosts] = useState<ForumPost[]>(() => [exampleForumPost()]);

  return (
    <MemberChrome
      notice={<ExampleNote />}
      posts={posts}
      members={members}
      memberEmpty={UNKNOWN_VALUE}
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
      referral={<ReferralSignupPreview />}
      feedback={<FeedbackInbox requests={[]} loading={false} onRespond={async () => null} />}
    />
  );
}
