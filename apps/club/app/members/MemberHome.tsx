"use client";

import { useMutation, useQuery } from "convex/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { FeedbackInbox } from "../../components/feedback/FeedbackInbox.tsx";
import { ReferralSignupConnected } from "../../components/referral/ReferralSignup.tsx";
import { MemberChrome } from "../../components/shell/MemberChrome.tsx";
import { api } from "../../convex/_generated/api";
import type { ClubRole } from "../../lib/clubRole.ts";

/**
 * Signed-in home. Sidebar items follow the role. The member panes are
 * the forum, referral signup, directory, evaluations, and events.
 * Admins also get the council board.
 */
export function MemberHome({
  onSignOut,
  clubRole = "member",
  council,
}: {
  onSignOut: () => void;
  clubRole?: ClubRole;
  council?: ReactNode;
}) {
  const posts = useQuery(api.club.listPosts);
  const members = useQuery(api.club.listMembers);
  const requests = useQuery(api.club.listMyFeedback);
  const addPost = useMutation(api.club.addPost);
  const respondToFeedback = useMutation(api.club.respondToFeedback);
  const [busy, setBusy] = useState(false);

  return (
    <MemberChrome
      clubRole={clubRole}
      posts={posts ?? []}
      members={members ?? []}
      loading={posts === undefined}
      membersLoading={members === undefined}
      busy={busy}
      onPost={(body) => {
        setBusy(true);
        void addPost({ body }).finally(() => setBusy(false));
      }}
      onSignOut={onSignOut}
      council={council}
      referral={<ReferralSignupConnected />}
      feedbackCount={requests?.length ?? 0}
      feedback={
        <FeedbackInbox
          requests={requests ?? []}
          loading={requests === undefined}
          onRespond={async (draft) => {
            try {
              const result = await respondToFeedback(draft);
              if (result && "error" in result && result.error) return result.error;
              return null;
            } catch (error) {
              return error instanceof Error ? error.message : "Could not submit that response.";
            }
          }}
        />
      }
    />
  );
}
