"use client";

import { useEffect, useMemo, useState } from "react";
import { ClubBoard } from "../../components/ClubBoard.tsx";
import { FeedbackInbox } from "../../components/feedback/FeedbackInbox.tsx";
import type { ForumPost } from "../../components/forum/Forum.tsx";
import { ReferralSignupPreview } from "../../components/referral/ReferralSignup.tsx";
import { ExampleNote } from "../../components/shell/ExampleNote.tsx";
import { MemberChrome } from "../../components/shell/MemberChrome.tsx";
import { UNKNOWN_VALUE } from "../../lib/copy.ts";
import {
  type DemoRoute,
  demoHashFor,
  exampleForumSeed,
  exampleMembers,
  exampleName,
  parseDemoHash,
} from "../../lib/exampleDemo.ts";
import type { ShellPane } from "../../lib/shellNav.ts";
import type { EngineResult } from "../../lib/types.ts";

/**
 * Public admin preview. Same sidebar an admin sees, filled from the seed.
 * No Convex client and no admin query.
 */
export function AdminDemo({ initial }: { initial: EngineResult }) {
  const [route, setRoute] = useState<DemoRoute>({ pane: "council", settings: false });
  const members = useMemo(() => exampleMembers(initial.state.people), [initial]);
  const author = exampleName(members[0]?.name);
  const [posts, setPosts] = useState<ForumPost[]>(() => [exampleForumSeed(author)]);

  useEffect(() => {
    const apply = () => setRoute(parseDemoHash(window.location.hash));
    apply();
    window.addEventListener("hashchange", apply);
    window.addEventListener("popstate", apply);
    return () => {
      window.removeEventListener("hashchange", apply);
      window.removeEventListener("popstate", apply);
    };
  }, []);

  const selectPane = (pane: ShellPane) => {
    setRoute({ pane, settings: false });
    const hash = demoHashFor(pane);
    const next = hash ? `/demo${hash}` : "/demo";
    window.history.pushState(null, "", next);
  };

  return (
    <MemberChrome
      clubRole="admin"
      pane={route.pane}
      onPaneChange={selectPane}
      notice={<ExampleNote />}
      posts={posts}
      members={members}
      memberEmpty={UNKNOWN_VALUE}
      onPost={(body) => {
        setPosts((current) => [
          {
            id: `example-${current.length}`,
            body,
            authorName: author,
            createdAt: new Date().toISOString(),
          },
          ...current,
        ]);
      }}
      council={
        <ClubBoard
          initial={initial}
          hotkeys={route.pane === "council"}
          requestedPanel={route.settings ? "settings" : null}
        />
      }
      referral={<ReferralSignupPreview />}
      feedback={<FeedbackInbox requests={[]} loading={false} onRespond={async () => null} />}
    />
  );
}
