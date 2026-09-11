/**
 * Display helpers for the admit/deny review loop (SEA-13).
 * Pure. No scoring. Used by CaseView/Evidence and by tests so the open-path
 * order is not a source-string pin.
 */

import { SCALE_LABELS } from "../../../src/domain/constants.ts";
import type { EvidenceItem, JudgeEvidenceGroup, PersonView, TrackRecordView } from "./types.ts";

/** After identity, the case opens on feedback. Ranks live behind More. */
export const CASE_OPEN_AFTER_IDENTITY = ["evaluator_feedback", "more"] as const;

/** Decision bar is a sibling of the scrolling pane, not an in-flow last child. */
export const CASE_DECISION_BAR = "viewport-sibling" as const;

/** Same window as referral Top-K. Reveal the next five each time. */
export const OPEN_REVIEWERS_PAGE = 5;

export function isOpinion(group: JudgeEvidenceGroup): boolean {
  return group.items.some((i) => i.kind === "referral" || i.kind === "evaluation");
}

/** Missing a track record is not a trust of 0 — those go last. */
export function trustOf(group: { trackRecord: { trust: number | null } }): number {
  return group.trackRecord.trust ?? Number.NEGATIVE_INFINITY;
}

/** Most trusted first. */
export function orderReviewers(groups: JudgeEvidenceGroup[]): JudgeEvidenceGroup[] {
  return groups.filter(isOpinion).sort((a, b) => {
    return trustOf(b) - trustOf(a) || a.name.localeCompare(b.name);
  });
}

export type ReviewerOpenBlock =
  | { kind: "evidence"; text: string }
  | { kind: "who"; name: string; trackRecord: TrackRecordView["label"] };

export function evidenceTexts(items: EvidenceItem[]): string[] {
  return items
    .filter((i) => i.kind === "referral" || i.kind === "evaluation")
    .map((item) => {
      if (item.kind === "referral") return item.evidenceText;
      return item.evidenceText || SCALE_LABELS.rubricNotObserved;
    });
}

/** Open card order: evidence text, then who + track-record. Not who-then-quote. */
export function reviewerOpenBlocks(group: JudgeEvidenceGroup): ReviewerOpenBlock[] {
  return [
    ...evidenceTexts(group.items).map((text) => ({ kind: "evidence" as const, text })),
    { kind: "who", name: group.name, trackRecord: group.trackRecord.label },
  ];
}

export function caseOpenPath(person: PersonView) {
  return {
    afterIdentity: CASE_OPEN_AFTER_IDENTITY,
    ranksOnOpenPath: false as const,
    decisionBar: CASE_DECISION_BAR,
    reviewers: orderReviewers(person.judgeEvidence).map((g) => ({
      judgeId: g.judgeId,
      name: g.name,
      blocks: reviewerOpenBlocks(g),
    })),
  };
}
