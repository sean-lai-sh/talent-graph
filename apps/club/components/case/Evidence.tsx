"use client";

import { useState } from "react";
import {
  DIMENSION_PROMPTS,
  DIMENSIONS,
  PRODUCT_LANGUAGE,
  REFERRAL_EVIDENCE_PROMPT,
  SCALE_LABELS,
} from "../../../../src/domain/constants.ts";
import { FEEDBACK_TONE } from "../../lib/copy.ts";
import { fmtDateShort, hoursLabel } from "../../lib/format.ts";
import { feedbackState, hoursUntil, REVIEW_STATUS_COPY } from "../../lib/review.ts";
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

const SHOWN_RESULTS = new Set(["won", "lost", "tie"]);

type PersonRecord = {
  id: string;
  name: string;
  items: ComparisonHistoryRow[];
  won: number;
  lost: number;
  tie: number;
};

function groupPeople(rows: ComparisonHistoryRow[]): PersonRecord[] {
  const byOther = new Map<string, PersonRecord>();
  for (const row of rows) {
    const existing = byOther.get(row.otherId);
    if (existing) {
      existing.items.push(row);
      if (row.result === "won") existing.won += 1;
      else if (row.result === "lost") existing.lost += 1;
      else existing.tie += 1;
    } else {
      byOther.set(row.otherId, {
        id: row.otherId,
        name: row.otherName,
        items: [row],
        won: row.result === "won" ? 1 : 0,
        lost: row.result === "lost" ? 1 : 0,
        tie: row.result === "tie" ? 1 : 0,
      });
    }
  }
  return [...byOther.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function recordLabel(person: PersonRecord): string {
  const parts: string[] = [];
  if (person.won > 0) parts.push(`won ${person.won}`);
  if (person.lost > 0) parts.push(`lost ${person.lost}`);
  if (person.tie > 0) parts.push(`tied ${person.tie}`);
  return parts.join(" · ");
}

function tallyByDimension(
  rows: ComparisonHistoryRow[],
  result: "won" | "lost" | "tie",
): { label: string; n: number }[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const row of rows) {
    if (row.result !== result) continue;
    const current = counts.get(row.dimension);
    if (current) current.n += 1;
    else counts.set(row.dimension, { label: row.dimensionLabel, n: 1 });
  }
  return DIMENSIONS.flatMap((dimension) => {
    const row = counts.get(dimension);
    return row ? [row] : [];
  });
}

function Opponent({ person }: { person: PersonRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium">{person.name}</p>
        <p className="shrink-0 text-xs text-muted">{recordLabel(person)}</p>
      </div>
      {open ? (
        <ul className="mt-1.5 space-y-1.5">
          {person.items.map((item) => (
            <li key={item.id} className="text-sm">
              <span className={item.result === "won" ? "text-ink" : "text-secondary"}>
                {item.result.replace("_", " ")}
              </span>
              <span className="text-muted"> · {item.dimensionLabel}</span>
              {item.evidenceText ? (
                <p className="mt-0.5 text-secondary">{item.evidenceText}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="press mt-1 text-xs text-secondary hover:text-ink"
      >
        {open ? "View less" : "View more"}
      </button>
    </li>
  );
}

function PeopleSection({ title, rows }: { title: string; rows: ComparisonHistoryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="border-b border-line pb-5">
      <h3 className="caps mb-2 text-muted">{title}</h3>
      <ul className="space-y-3">
        {groupPeople(rows).map((person) => (
          <Opponent key={person.id} person={person} />
        ))}
      </ul>
    </section>
  );
}

function StatSection({ title, rows }: { title: string; rows: { label: string; n: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="border-b border-line pb-5 last:border-b-0 last:pb-0">
      <h3 className="caps mb-2 text-muted">{title}</h3>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-baseline justify-between gap-3 text-sm">
            <span>{row.label}</span>
            <span className="text-muted">{row.n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ComparisonsPane({ person }: { person: PersonView }) {
  const informative = person.comparisonHistory.filter((c) => SHOWN_RESULTS.has(c.result));
  const members = informative.filter((c) => c.otherStatus === "member");
  const others = informative.filter((c) => c.otherStatus !== "member");
  if (informative.length === 0) {
    return <p className="text-sm text-muted">{PRODUCT_LANGUAGE.insufficientEvidence}</p>;
  }
  return (
    <div className="space-y-5">
      <p className="sr-only">{PRODUCT_LANGUAGE.relativeCapability}</p>
      <PeopleSection title="Members" rows={members} />
      <PeopleSection title="External" rows={others} />
      <StatSection title="Wins" rows={tallyByDimension(informative, "won")} />
      <StatSection title="Losses" rows={tallyByDimension(informative, "lost")} />
      <StatSection title="Ties" rows={tallyByDimension(informative, "tie")} />
    </div>
  );
}

export function Reviews({
  person,
  clock,
  onAsk,
  onCompare,
  onRecord,
}: {
  person: PersonView;
  clock: IsoDate;
  onAsk: () => void;
  onCompare: () => void;
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
  const hasCompares = person.comparisonHistory.some((c) => SHOWN_RESULTS.has(c.result));

  return (
    <section className="card card-read">
      <h2 className="card-h">
        Referrals
        <span className="count">{ranked.length || ""}</span>
        <span className="card-actions">
          {hasCompares ? (
            <button type="button" onClick={onCompare} className="press">
              View comparisons ›
            </button>
          ) : null}
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

export function AlsoVouched({ person, people }: { person: PersonView; people: PersonView[] }) {
  const mine = new Set(person.referrals.map((r) => r.referrerId));
  const seen = new Set<string>();
  const shared: { id: string; name: string; via: string; signal: number | null }[] = [];
  for (const other of people) {
    if (other.id === person.id) continue;
    for (const r of other.referrals) {
      if (mine.has(r.referrerId) && !seen.has(other.id)) {
        seen.add(other.id);
        shared.push({
          id: other.id,
          name: other.name,
          via: r.referrerName,
          signal: other.v2Signal,
        });
      }
    }
  }
  return (
    <section className="card">
      <h2 className="card-h">
        Also vouched for
        <span className="count">{shared.length || ""}</span>
      </h2>
      {shared.length === 0 ? (
        <p className="empty-note">These referrers haven’t vouched for anyone else.</p>
      ) : (
        shared.map((row) => (
          <div key={row.id} className="cmp">
            <span className="who">{row.name}</span>
            <span className="via">via {row.via}</span>
            <span className="sc">{row.signal === null ? "—" : row.signal}</span>
          </div>
        ))
      )}
    </section>
  );
}

export function Activity({ person }: { person: PersonView }) {
  const scored = person.v2Signal !== null;
  const rows: { what: string; when: string }[] = [
    { what: "Applied", when: fmtDateShort(person.createdAt) },
    {
      what:
        person.incomingCount === 0
          ? "No referrals"
          : `${person.incomingCount} referral${person.incomingCount === 1 ? "" : "s"}`,
      when: person.incomingCount > 0 ? "received" : "",
    },
    {
      what: scored ? `Scored ${person.v2Signal}` : "Not scored yet",
      when: "",
    },
    {
      what:
        person.reviewStatus === "admitted" || person.reviewStatus === "denied"
          ? REVIEW_STATUS_COPY[person.reviewStatus]
          : "Awaiting decision",
      when: "",
    },
  ];
  return (
    <section className="card">
      <h2 className="card-h">Activity</h2>
      {rows.map((row) => (
        <div key={row.what} className="act">
          <span>{row.what}</span>
          <span className="when">{row.when}</span>
        </div>
      ))}
    </section>
  );
}
