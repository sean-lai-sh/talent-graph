/**
 * Council workflow helpers. Pure. The engine in src/ never sees any of this:
 * review status is mapped onto the engine's candidate | member | archived.
 */

import type { PersonStatus } from "../../../src/domain/types.ts";
import type {
  ClubFeedbackRequest,
  Decision,
  FeedbackState,
  IsoDate,
  ReviewStatus,
} from "./types.ts";

export const FEEDBACK_WINDOW_HOURS = 48;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const REVIEW_STATUS_ORDER: readonly ReviewStatus[] = [
  "new",
  "under_review",
  "needs_data",
  "admitted",
  "denied",
] as const;

export const REVIEW_STATUS_COPY: Record<ReviewStatus, string> = {
  new: "New",
  under_review: "Under review",
  needs_data: "Needs data",
  admitted: "Admitted",
  denied: "Denied",
};

export const DECISION_COPY: Record<Decision, string> = {
  start_review: "Start review",
  admit: "Admit",
  deny: "Deny",
  request_data: "Request more data",
  reopen: "Reopen",
};

/** Engine status implied by a review status. */
export function statusForReview(review: ReviewStatus): PersonStatus {
  if (review === "admitted") return "member";
  if (review === "denied") return "archived";
  return "candidate";
}

/** Review status to assume for a person written before this field existed. */
export function defaultReviewStatus(status: PersonStatus): ReviewStatus {
  if (status === "member") return "admitted";
  if (status === "archived") return "denied";
  return "new";
}

/** A person is under consideration until admitted or denied. */
export function underConsideration(review: ReviewStatus): boolean {
  return review !== "admitted" && review !== "denied";
}

const TRANSITIONS: Record<Decision, { from: readonly ReviewStatus[]; to: ReviewStatus }> = {
  start_review: { from: ["new", "needs_data"], to: "under_review" },
  admit: { from: ["new", "under_review", "needs_data"], to: "admitted" },
  deny: { from: ["new", "under_review", "needs_data"], to: "denied" },
  request_data: { from: ["new", "under_review"], to: "needs_data" },
  reopen: { from: ["admitted", "denied"], to: "under_review" },
};

export function nextReviewStatus(current: ReviewStatus, decision: Decision): ReviewStatus | null {
  const t = TRANSITIONS[decision];
  return t.from.includes(current) ? t.to : null;
}

export function availableDecisions(current: ReviewStatus): Decision[] {
  return (Object.keys(TRANSITIONS) as Decision[]).filter(
    (d) => nextReviewStatus(current, d) !== null,
  );
}

export function dueAtFor(requestedAt: IsoDate): IsoDate {
  return new Date(new Date(requestedAt).getTime() + FEEDBACK_WINDOW_HOURS * HOUR).toISOString();
}

export function feedbackState(
  req: Pick<ClubFeedbackRequest, "dueAt" | "respondedAt">,
  clock: IsoDate,
): FeedbackState {
  if (req.respondedAt !== null) return "responded";
  return new Date(clock).getTime() > new Date(req.dueAt).getTime() ? "overdue" : "pending";
}

/** Signed hours from `clock` to `dueAt`; negative when overdue. */
export function hoursUntil(dueAt: IsoDate, clock: IsoDate): number {
  return (new Date(dueAt).getTime() - new Date(clock).getTime()) / HOUR;
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, Math.floor(ms / DAY));
}
