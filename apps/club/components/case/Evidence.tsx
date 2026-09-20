"use client";

import { useId, useState } from "react";
import {
  DIMENSION_PROMPTS,
  PRODUCT_LANGUAGE,
  REFERRAL_EVIDENCE_PROMPT,
  SCALE_LABELS,
} from "../../../../src/domain/constants.ts";
import type { Dimension } from "../../../../src/domain/types.ts";
import { recordSummary, recordsByTrait, type TraitRecord } from "../../lib/comparisonRecord.ts";
import { FEEDBACK_TONE } from "../../lib/copy.ts";
import { fmtDateShort, hoursLabel } from "../../lib/format.ts";
import { feedbackState, hoursUntil } from "../../lib/review.ts";
import type {
  ComparisonHistoryRow,
  EvidenceItem,
  FeedbackView,
  IsoDate,
  JudgeEvidenceGroup,
  PersonView,
} from "../../lib/types.ts";
import { Badge } from "../ui/Badge.tsx";

/** Same window as referral Top-K. Reveal the next five each time. */
const PAGE = 5;

function isReferrer(group: JudgeEvidenceGroup): boolean {
  return group.items.some((i) => i.kind === "referral");
}

function trustOf(group: { trackRecord: { trust: number | null } }): number {
  return group.trackRecord.trust ?? Number.NEGATIVE_INFINITY;
}

/** Most trusted first. Missing a track record is not a trust of 0 — those go last. */
function orderReviewers(groups: JudgeEvidenceGroup[]): JudgeEvidenceGroup[] {
  return groups.filter(isReferrer).sort((a, b) => {
    return trustOf(b) - trustOf(a) || a.name.localeCompare(b.name);
  });
}

function convictionOf(group: JudgeEvidenceGroup): number {
  const referral = group.items.find((i) => i.kind === "referral");
  return referral && referral.kind === "referral" ? referral.conviction : 3;
}

function hasWrittenNote(group: JudgeEvidenceGroup): boolean {
  return group.items.some(
    (i) => (i.kind === "referral" || i.kind === "evaluation") && i.evidenceText.trim().length > 0,
  );
}

function Chevron() {
  return (
    <svg className="chev" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 4.5 6 8l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Opinion({ items }: { items: EvidenceItem[] }) {
  const rows = items.filter((i) => i.kind === "referral");
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="sr-only">{PRODUCT_LANGUAGE.structuredEvidence}</p>
      {rows.map((item) =>
        item.kind === "referral" ? (
          <div key={item.id} className="ref-inner">
            <div className="prompt">
              <p className="q">{REFERRAL_EVIDENCE_PROMPT}</p>
              <p className="claim">{SCALE_LABELS.conviction[item.conviction]}</p>
            </div>
            <p className="answer">{item.evidenceText.trim() || SCALE_LABELS.rubricNotObserved}</p>
          </div>
        ) : null,
      )}
    </div>
  );
}

function Reviewer({
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
  const written = hasWrittenNote(group);
  if (!written) {
    return (
      <div className={`ref t${convictionOf(group)}`}>
        <div className="ref-head">
          <span className="ref-name" style={{ color: "var(--t4)" }}>
            {group.name}
          </span>
          {pending ? (
            <Badge tone={FEEDBACK_TONE[pending.state]}>
              {pending.state === "overdue" ? "overdue" : "asked"}
            </Badge>
          ) : (
            <span className="note">no note yet</span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={`ref t${convictionOf(group)}${open ? " is-open" : ""}`}>
      <button type="button" className="ref-head" aria-expanded={open} onClick={onToggle}>
        <span className="ref-name">{group.name}</span>
        {pending ? (
          <Badge tone={FEEDBACK_TONE[pending.state]}>
            {pending.state === "overdue" ? "overdue" : "asked"}
          </Badge>
        ) : null}
        <Chevron />
      </button>
      <div className="ref-body">
        <div>
          <Opinion items={group.items} />
        </div>
      </div>
    </div>
  );
}

function OpponentColumn({ title, rows }: { title: string; rows: ComparisonHistoryRow[] }) {
  return (
    <div className="min-w-[10rem] flex-1">
      <p className="caps mb-1.5 text-muted">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">—</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.id} className="text-sm">
              <span>
                {row.otherName}
                {row.otherStatus === "member" ? " · member" : ""}
              </span>
              {row.evidenceText ? (
                <p className="mt-0.5 text-secondary">{row.evidenceText}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Trait({
  record,
  open,
  onToggle,
}: {
  record: TraitRecord;
  open: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  return (
    <div className={`trait${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="trait-head"
        aria-expanded={open}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-record`}
        onClick={onToggle}
      >
        <span id={`${id}-name`} className="trait-name">
          {record.label}
        </span>
        <span id={`${id}-record`} className="trait-record">
          {recordSummary(record)}
        </span>
        <Chevron />
      </button>
      <div className="trait-body" aria-hidden={!open}>
        <div>
          <div className="flex flex-wrap gap-6 pb-4">
            <OpponentColumn title="Won against" rows={record.won} />
            <OpponentColumn title="Lost to" rows={record.lost} />
            {record.tie.length > 0 ? <OpponentColumn title="Tied" rows={record.tie} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ComparisonsPane({ person }: { person: PersonView }) {
  const records = recordsByTrait(person.comparisonHistory);
  const [openDimension, setOpenDimension] = useState<Dimension | null>(null);
  if (records.length === 0) {
    return <p className="text-sm text-muted">{PRODUCT_LANGUAGE.insufficientEvidence}</p>;
  }
  return (
    <div>
      <p className="sr-only">{PRODUCT_LANGUAGE.relativeCapability}</p>
      {records.map((record) => (
        <Trait
          key={record.dimension}
          record={record}
          open={openDimension === record.dimension}
          onToggle={() =>
            setOpenDimension((d) => (d === record.dimension ? null : record.dimension))
          }
        />
      ))}
    </div>
  );
}

export function Reviews({
  person,
  clock,
  onAsk,
  onRecord,
}: {
  person: PersonView;
  clock: IsoDate;
  onAsk: () => void;
  onRecord: (request: FeedbackView) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const pendingByMember = new Map(
    person.feedback.filter((f) => f.state !== "responded").map((f) => [f.memberId, f]),
  );
  const ranked = orderReviewers(person.judgeEvidence);
  const firstNote = ranked.find(hasWrittenNote);
  const [openId, setOpenId] = useState<string | null>(firstNote?.judgeId ?? null);
  const visible = ranked.slice(0, shown);
  const hidden = ranked.length - visible.length;
  const seen = new Set(ranked.map((g) => g.judgeId));
  const waiting = person.feedback
    .filter((f) => f.state !== "responded" && !seen.has(f.memberId))
    .sort((a, b) => trustOf(b) - trustOf(a) || a.memberName.localeCompare(b.memberName));

  return (
    <section className="card card-read">
      <h2 className="card-h">
        Referrals
        <span className="count">{ranked.length || ""}</span>
        <span className="card-actions">
          <button type="button" onClick={onAsk} aria-label="Ask someone" className="press">
            +
          </button>
        </span>
      </h2>
      {ranked.length > 0 ? (
        <p className="card-lead">Ordered by whose judgment we trust most.</p>
      ) : null}
      {ranked.length === 0 && waiting.length === 0 ? (
        <p className="empty-note">No referrals yet. Waiting on someone to vouch.</p>
      ) : (
        <div>
          {visible.map((g) => (
            <Reviewer
              key={g.judgeId}
              group={g}
              pending={pendingByMember.get(g.judgeId)}
              open={openId === g.judgeId}
              onToggle={() => setOpenId((id) => (id === g.judgeId ? null : g.judgeId))}
            />
          ))}
          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="press w-full py-2 text-left text-xs text-secondary hover:text-ink"
            >
              {Math.min(PAGE, hidden)} more
            </button>
          ) : null}
          {waiting.map((f) => {
            const state = feedbackState(f, clock);
            return (
              <div key={f.id} className="ref">
                <div className="ref-head">
                  <span className="ref-name" style={{ color: "var(--t4)" }}>
                    {f.memberName}
                  </span>
                  <span className="note">{hoursLabel(hoursUntil(f.dueAt, clock))}</span>
                  <Badge tone={FEEDBACK_TONE[state]}>{state}</Badge>
                  <button
                    type="button"
                    className="press text-xs text-secondary hover:text-ink"
                    onClick={() => onRecord(f)}
                  >
                    Record
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function CommitteeNotes({ person }: { person: PersonView }) {
  const notes = [
    ...person.feedback
      .filter((f) => f.note.trim().length > 0)
      .map((f) => ({
        id: f.id,
        by: f.memberName,
        when: fmtDateShort(f.requestedAt),
        text: f.note,
      })),
    ...person.evaluations
      .filter((e) => e.evidenceText.trim().length > 0)
      .map((e) => ({
        id: e.id,
        by: e.evaluatorName,
        when: fmtDateShort(e.createdAt),
        text: e.evidenceText,
        prompt: DIMENSION_PROMPTS[e.dimension],
        claim:
          e.score === null
            ? PRODUCT_LANGUAGE.notObserved
            : e.scoreLabel || SCALE_LABELS.rubricNotObserved,
      })),
  ];
  return (
    <section className="card">
      <h2 className="card-h">
        Committee notes
        <span className="count">{notes.length || ""}</span>
      </h2>
      {notes.length === 0 ? (
        <p className="empty-note">Nothing written down yet.</p>
      ) : (
        notes.map((note) => (
          <div key={note.id} className="note-item">
            <div className="note-meta">
              {note.by} · {note.when}
            </div>
            <p className="note-text">{note.text}</p>
          </div>
        ))
      )}
    </section>
  );
}
