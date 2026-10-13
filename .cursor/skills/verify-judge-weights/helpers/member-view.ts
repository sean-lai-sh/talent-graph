/**
 * Objects a member is allowed to see. Built from the pure view helpers,
 * then scanned. The types are asserted in tests/verify-judge-weights.test.ts.
 */

import { emptyState } from "../../../../apps/club/lib/engine.ts";
import { openComparisonStep } from "../../../../apps/club/lib/ladderPlacement.ts";
import { toDirectoryMembers } from "../../../../apps/club/lib/memberDirectory.ts";
import { listOwnFeedbackRequests } from "../../../../apps/club/lib/memberFeedback.ts";
import { lookupDecision } from "../../../../apps/club/lib/referralSignup.ts";
import { scanWeightKeys, type WeightHit } from "./scan.ts";

export function memberViewObjects(): unknown[] {
  const directory = toDirectoryMembers([
    {
      id: "ex-ada-referrer",
      name: "Ada Quill",
      status: "member",
      email: "ada.quill@example.test",
      linkedin: "https://www.linkedin.com/in/ada-quill",
    },
  ]);
  const inbox = listOwnFeedbackRequests({
    orgs: [],
    email: "ada.quill@example.test",
    clock: "2026-06-01T00:00:00.000Z",
  });
  const lookup = lookupDecision({
    raw: "edd.pike@example.test",
    actor: { email: "ada.quill@example.test" },
    profileExists: false,
  });
  const ladder = openComparisonStep({
    session: { email: "ada.quill@example.test" },
    ownedPersonIds: [],
    state: emptyState("2026-06-01T00:00:00.000Z"),
    personId: "ex-app-edd",
  });
  const role = { role: "member" as const, email: "ada.quill@example.test" };
  const post = {
    id: "post-1",
    body: "Hello from the forum.",
    authorName: "Ada Quill",
    createdAt: "2026-06-01T00:00:00.000Z",
  };
  const status = { line: "Referred in June 2026." };
  return [directory, inbox, lookup, ladder, role, post, status];
}

export function memberViewHits(): WeightHit[] {
  return memberViewObjects().flatMap((value) => scanWeightKeys(value));
}
