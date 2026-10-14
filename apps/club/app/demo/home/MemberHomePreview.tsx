"use client";

import { useMemo, useState } from "react";
import { FeedbackInbox } from "../../../components/feedback/FeedbackInbox.tsx";
import type { ForumPost } from "../../../components/forum/Forum.tsx";
import { ReferralSignupPreview } from "../../../components/referral/ReferralSignup.tsx";
import { ExampleNote } from "../../../components/shell/ExampleNote.tsx";
import { MemberChrome } from "../../../components/shell/MemberChrome.tsx";
import { UNKNOWN_VALUE } from "../../../lib/copy.ts";
import { initialState } from "../../../lib/engine.ts";
import { exampleForumSeed, exampleMembers, exampleName } from "../../../lib/exampleDemo.ts";

/** Hidden `/demo/home` preview — local posts, seed member directory, no Convex. */
export function MemberHomePreview() {
  const members = useMemo(() => exampleMembers(initialState().people), []);
  const author = exampleName(members[0]?.name);
  const [posts, setPosts] = useState<ForumPost[]>(() => [exampleForumSeed(author)]);

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
