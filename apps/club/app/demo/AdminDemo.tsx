"use client";

import { useEffect, useState } from "react";
import { ClubBoard } from "../../components/ClubBoard.tsx";
import { FeedbackInbox } from "../../components/feedback/FeedbackInbox.tsx";
import type { ForumPost } from "../../components/forum/Forum.tsx";
import { ReferralSignupPreview } from "../../components/referral/ReferralSignupForm.tsx";
import { ExampleNote } from "../../components/shell/ExampleNote.tsx";
import { MemberChrome } from "../../components/shell/MemberChrome.tsx";
import { UNKNOWN_VALUE } from "../../lib/copy.ts";
import {
  type DemoRoute,
  demoHashFor,
  exampleDirectory,
  exampleForumPost,
  parseDemoHash,
} from "../../lib/exampleDemo.ts";
import type { ShellPane } from "../../lib/shellNav.ts";
import type { EngineResult } from "../../lib/types.ts";

/**
 * Public admin preview. Same sidebar an admin sees.
 * The council board is the in-memory seed. Directory, phones, and the forum
 * note come from the static fixture. No Convex client and no Convex query.
 */
export function AdminDemo({ initial }: { initial: EngineResult }) {
  const [route, setRoute] = useState<DemoRoute>({ pane: "council", settings: false });
  const members = exampleDirectory();
  const author = exampleForumPost().authorName;
  const [posts, setPosts] = useState<ForumPost[]>(() => [exampleForumPost()]);

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
