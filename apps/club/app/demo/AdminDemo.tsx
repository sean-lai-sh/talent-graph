"use client";

import { useEffect, useState } from "react";
import { ClubBoard } from "../../components/ClubBoard.tsx";
import type { ForumPost } from "../../components/forum/Forum.tsx";
import { MemberChrome } from "../../components/shell/MemberChrome.tsx";
import {
  type DemoRoute,
  demoHashFor,
  exampleDirectory,
  exampleForumPost,
  parseDemoHash,
} from "../../lib/exampleDemo.ts";
import type { ShellPane } from "../../lib/shellNav.ts";
import type { EngineResult } from "../../lib/types.ts";
import { actionExampleReset } from "./actions.ts";
import { DemoEvaluations } from "./DemoEvaluations.tsx";
import { DemoMemberList } from "./DemoMemberList.tsx";
import { DemoReferral } from "./DemoReferral.tsx";
import { ExampleNote } from "./ExampleNote.tsx";

/**
 * Public admin preview. Same sidebar an admin sees.
 * The council board is the engine view of the static fixture. Directory,
 * phones, and the forum note come from those same inputs. No Convex query.
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
      retainPanes
      keyboardNav
      notice={<ExampleNote />}
      posts={posts}
      members={members}
      membersPane={<DemoMemberList />}
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
          actions={{ reset: actionExampleReset }}
          hotkeys={route.pane === "council"}
          requestedPanel={route.settings ? "settings" : null}
        />
      }
      referral={<DemoReferral />}
      feedback={<DemoEvaluations />}
    />
  );
}
