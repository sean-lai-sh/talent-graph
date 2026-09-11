"use client";

import { useState } from "react";
import {
  DIMENSION_PROMPTS,
  PRODUCT_LANGUAGE,
  REFERRAL_EVIDENCE_PROMPT,
  SCALE_LABELS,
} from "../../../../src/domain/constants.ts";
import { TRACK_RECORD_COPY } from "../../../../src/judges/trackRecord.ts";
import { FEEDBACK_TONE, TRACK_RECORD_TONE } from "../../lib/copy.ts";
import { daysLabel, hoursLabel } from "../../lib/format.ts";
import { feedbackState, hoursUntil, REVIEW_STATUS_COPY } from "../../lib/review.ts";
import { OPEN_REVIEWERS_PAGE, orderReviewers, trustOf } from "../../lib/reviewLoop.ts";
import type {
  ComparisonHistoryRow,
  EvidenceItem,
  FeedbackView,
  IsoDate,
  JudgeEvidenceGroup,
  PersonView,
} from "../../lib/types.ts";
import { Badge } from "../ui/Badge.tsx";

function kindLabel(items: EvidenceItem[]): string {
  const kinds = new Set(items.map((i) => i.kind));
  const parts = [
    kinds.has("referral") ? "referred" : "",
    kinds.has("evaluation") ? "wrote" : "",
  ].filter(Boolean);
  return parts.join(" · ") || "reviewed";
}

function Answer({
  question,
  note,
  children,
}: {
  question: string;
  note?: string;
  children: string;
}) {
  return (
    <div className="border-b border-line py-2 last:border-b-0">
      <p className="text-sm text-ink">{question}</p>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
      <p className="mt-1 text-sm leading-snug text-secondary">{children}</p>
    </div>
  );
}

function Opinion({ items }: { items: EvidenceItem[] }) {
  const rows = items.filter((i) => i.kind === "referral" || i.kind === "evaluation");
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="sr-only">{PRODUCT_LANGUAGE.structuredEvidence}</p>
      {rows.map((item) => {
        if (item.kind === "referral") {
          return (
            <Answer
              key={item.id}
              question={REFERRAL_EVIDENCE_PROMPT}
              note={SCALE_LABELS.conviction[item.conviction]}
            >
              {item.evidenceText}
            </Answer>
          );
        }
        if (item.kind === "evaluation") {
          const note =
            item.score === null
              ? PRODUCT_LANGUAGE.notObserved
              : item.scoreLabel || SCALE_LABELS.rubricNotObserved;
          return (
            <Answer key={item.id} question={DIMENSION_PROMPTS[item.dimension]} note={note}>
              {item.evidenceText || SCALE_LABELS.rubricNotObserved}
            </Answer>
          );
        }
        return null;
      })}
    </div>
  );
}

function WhoRow({
  group,
  pending,
  open,
  onToggle,
}: {
  group: JudgeEvidenceGroup;
  pending: FeedbackView | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full cursor-pointer items-center gap-2 py-2.5 text-left text-sm"
    >
      <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
      <Badge tone={TRACK_RECORD_TONE[group.trackRecord.label]}>
        {TRACK_RECORD_COPY[group.trackRecord.label]}
      </Badge>
      <span className="text-xs text-muted">{kindLabel(group.items)}</span>
      {pending ? (
        <Badge tone={FEEDBACK_TONE[pending.state]}>
          {pending.state === "overdue" ? "overdue" : "asked"}
        </Badge>
      ) : null}
    </button>
  );
}

function Reviewer({
  group,
  pending,
  defaultOpen,
}: {
  group: JudgeEvidenceGroup;
  pending: FeedbackView | undefined;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((v) => !v);
  return (
    <div className="border-b border-line">
      {open ? (
        <div data-reviewer-open="">
          <Opinion items={group.items} />
          <WhoRow group={group} pending={pending} open onToggle={toggle} />
        </div>
      ) : (
        <WhoRow group={group} pending={pending} open={false} onToggle={toggle} />
      )}
    </div>
  );
}

const SHOWN_RESULTS = new Set(["won", "lost", "tie"]);

function CompareGroup({ title, rows }: { title: string; rows: ComparisonHistoryRow[] }) {
  if (rows.length === 0) return null;
  const byOther = new Map<string, ComparisonHistoryRow[]>();
  for (const row of rows) {
    const list = byOther.get(row.otherId);
    if (list) list.push(row);
    else byOther.set(row.otherId, [row]);
  }
  return (
    <div>
      <h3 className="caps mb-2 text-muted">{title}</h3>
      <ul className="space-y-3">
        {[...byOther.entries()].map(([id, items]) => {
          const name = items[0]?.otherName ?? id;
          return (
            <li key={id}>
              <p className="text-sm font-medium">{name}</p>
              <ul className="mt-1 space-y-1">
                {items.map((c) => (
                  <li key={c.id} className="text-sm">
                    <span className={c.result === "won" ? "text-ink" : "text-secondary"}>
                      {c.result.replace("_", " ")}
                    </span>
                    <span className="text-muted"> · {c.dimensionLabel}</span>
                    {c.evidenceText ? (
                      <p className="mt-0.5 text-secondary">{c.evidenceText}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ComparisonsPane({ person }: { person: PersonView }) {
  const informative = person.comparisonHistory.filter((c) => SHOWN_RESULTS.has(c.result));
  const members = informative.filter((c) => c.otherStatus === "member");
  const others = informative.filter((c) => c.otherStatus !== "member");
  return (
    <section>
      <h3 className="caps mb-2 text-muted">Pairwise</h3>
      {informative.length === 0 ? (
        <p className="text-sm text-muted">{PRODUCT_LANGUAGE.insufficientEvidence}</p>
      ) : (
        <div className="space-y-6">
          <p className="sr-only">{PRODUCT_LANGUAGE.relativeCapability}</p>
          <CompareGroup title="Members" rows={members} />
          <CompareGroup title="Others we've seen" rows={others} />
        </div>
      )}
    </section>
  );
}

export function NeighbourhoodPane({ person }: { person: PersonView }) {
  const { referrers, referred } = person.neighbourhood;
  return (
    <section>
      <h3 className="caps mb-2 text-muted">Neighbourhood</h3>
      {referrers.length === 0 && referred.length === 0 ? (
        <p className="text-sm text-muted">{PRODUCT_LANGUAGE.insufficientEvidence}</p>
      ) : (
        <div className="space-y-3 text-sm">
          {referrers.length > 0 ? (
            <p>
              <span className="text-muted">Referred by </span>
              {referrers.map((n) => n.name).join(", ")}
            </p>
          ) : null}
          {referred.length > 0 ? (
            <p>
              <span className="text-muted">Referred </span>
              {referred.map((n) => n.name).join(", ")}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function DecisionContext({ person }: { person: PersonView }) {
  return (
    <section>
      <h3 className="caps mb-2 text-muted">Decision</h3>
      <p className="text-sm">
        {REVIEW_STATUS_COPY[person.reviewStatus]}
        <span className="text-muted"> · {daysLabel(person.daysInReview)} in review</span>
      </p>
      {person.queue?.reasons[0] ? (
        <p className="mt-1 text-sm text-secondary">{person.queue.reasons[0]}</p>
      ) : null}
      {person.missingEvidence.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-secondary">
          {person.missingEvidence.map((m) => (
            <li key={`${m.kind}:${m.dimension ?? ""}`}>{m.text}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function Reviews({
  person,
  clock,
  openByDefault = false,
  onAsk,
  onRecord,
}: {
  person: PersonView;
  clock: IsoDate;
  openByDefault?: boolean;
  onAsk: () => void;
  onRecord: (request: FeedbackView) => void;
}) {
  const [shown, setShown] = useState(OPEN_REVIEWERS_PAGE);
  const pendingByMember = new Map(
    person.feedback.filter((f) => f.state !== "responded").map((f) => [f.memberId, f]),
  );
  const ranked = orderReviewers(person.judgeEvidence);
  const visible = ranked.slice(0, shown);
  const hidden = ranked.length - visible.length;
  const seen = new Set(ranked.map((g) => g.judgeId));
  const waiting = person.feedback
    .filter((f) => f.state !== "responded" && !seen.has(f.memberId))
    .sort((a, b) => trustOf(b) - trustOf(a) || a.memberName.localeCompare(b.memberName));

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">Evaluator feedback</h3>
        <button
          type="button"
          onClick={onAsk}
          aria-label="Ask someone"
          className="press flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-secondary hover:bg-subtle hover:text-ink"
        >
          +
        </button>
      </div>
      {ranked.length > 0 ? (
        <p className="mb-2 text-xs text-muted">
          Evidence first, then who wrote it and their record.
        </p>
      ) : null}
      {ranked.length === 0 && waiting.length === 0 ? (
        <p className="py-3 text-sm text-muted">Nobody has written anything yet.</p>
      ) : (
        <div>
          {visible.map((g) => (
            <Reviewer
              key={g.judgeId}
              group={g}
              pending={pendingByMember.get(g.judgeId)}
              defaultOpen={openByDefault}
            />
          ))}
          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setShown((n) => n + OPEN_REVIEWERS_PAGE)}
              className="press w-full py-2 text-left text-xs text-secondary hover:text-ink"
            >
              {Math.min(OPEN_REVIEWERS_PAGE, hidden)} more
            </button>
          ) : null}
          {waiting.map((f) => {
            const state = feedbackState(f, clock);
            return (
              <div
                key={f.id}
                className="flex items-center gap-2 border-b border-line py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{f.memberName}</span>
                <Badge tone={TRACK_RECORD_TONE[f.trackRecord.label]}>
                  {TRACK_RECORD_COPY[f.trackRecord.label]}
                </Badge>
                <span className="text-xs text-muted">{hoursLabel(hoursUntil(f.dueAt, clock))}</span>
                <Badge tone={FEEDBACK_TONE[state]}>{state}</Badge>
                <button
                  type="button"
                  className="press text-xs text-secondary hover:text-ink"
                  onClick={() => onRecord(f)}
                >
                  Record
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
