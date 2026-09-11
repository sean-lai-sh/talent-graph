"use client";

import { REVIEW_BUCKET_COPY } from "../../../../src/analysis/reviewQueue.ts";
import { PRODUCT_LANGUAGE, SCALE_LABELS } from "../../../../src/domain/constants.ts";
import { TRACK_RECORD_COPY } from "../../../../src/judges/trackRecord.ts";
import { BUCKET_TONE, FEEDBACK_TONE, TRACK_RECORD_TONE } from "../../lib/copy.ts";
import { fmtDate, fmtDateTime, hoursLabel, ordinal, plural } from "../../lib/format.ts";
import { feedbackState, hoursUntil } from "../../lib/review.ts";
import type {
  ClubSnapshot,
  EvidenceItem,
  FeedbackView,
  IsoDate,
  JudgeEvidenceGroup,
  PersonView,
  TrackRecordView,
} from "../../lib/types.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Num } from "../ui/Num.tsx";
import { Section } from "../ui/Section.tsx";

export function TrackBadge({ track }: { track: TrackRecordView }) {
  const label = TRACK_RECORD_COPY[track.label];
  const scored = track.evaluatedCount > 0 ? ` · ${track.evaluatedCount} scored` : "";
  return (
    <Badge
      tone={TRACK_RECORD_TONE[track.label]}
      title="Track record: how this judge's past referrals matched later outcomes. Referrals only; a label, not a weight."
    >
      {label}
      {scored}
    </Badge>
  );
}

export function QueueNote({ person }: { person: PersonView }) {
  if (!person.queue) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
      <Badge tone={BUCKET_TONE[person.queue.bucket]}>
        {REVIEW_BUCKET_COPY[person.queue.bucket].label}
      </Badge>
      {person.queue.flags
        .filter((f) => f !== person.queue?.bucket)
        .map((f) => (
          <Badge key={f} tone={BUCKET_TONE[f]}>
            {REVIEW_BUCKET_COPY[f].label}
          </Badge>
        ))}
      <span>{person.queue.reasons.join(" · ")}</span>
    </div>
  );
}

export function MissingEvidence({
  person,
  onAsk,
}: {
  person: PersonView;
  onAsk: (memberId: string) => void;
}) {
  return (
    <Section
      title="Missing evidence"
      hint="Built only from engine states and this round's required dimensions."
    >
      {person.missingEvidence.length === 0 ? (
        <p className="text-sm text-muted">Nothing required is missing.</p>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {person.missingEvidence.map((m) => (
            <li key={`${m.kind}:${m.dimension ?? ""}`}>{m.text}</li>
          ))}
        </ul>
      )}
      {person.suggestedMembers.length > 0 ? (
        <div className="mt-3">
          <p className="caps mb-1 text-muted">Suggested members to ask</p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {person.suggestedMembers.map((m) => (
              <li key={m.personId} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {m.name} <span className="text-muted">· {m.because}</span>
                </span>
                <TrackBadge track={m.trackRecord} />
                <Button size="sm" variant="ghost" onClick={() => onAsk(m.personId)}>
                  Request feedback
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

export function FeedbackRequests({
  person,
  clock,
  onRecord,
}: {
  person: PersonView;
  clock: IsoDate;
  onRecord: (request: FeedbackView) => void;
}) {
  return (
    <Section
      title="Feedback requests"
      hint="Members have 48 hours. A response is a rubric evaluation from that member."
    >
      {person.feedback.length === 0 ? (
        <p className="text-sm text-muted">No requests yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {person.feedback.map((f) => {
            const state = feedbackState(f, clock);
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{f.memberName}</span>{" "}
                  <TrackBadge track={f.trackRecord} />
                  {f.note ? <span className="block text-xs text-secondary">{f.note}</span> : null}
                </span>
                <span className="text-xs text-muted">requested {fmtDateTime(f.requestedAt)}</span>
                <Badge tone={FEEDBACK_TONE[state]}>
                  {state === "responded"
                    ? `responded ${f.respondedAt ? fmtDate(f.respondedAt) : ""}`
                    : hoursLabel(hoursUntil(f.dueAt, clock))}
                </Badge>
                {state !== "responded" ? (
                  <Button size="sm" variant="ghost" onClick={() => onRecord(f)}>
                    Record response
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function ItemLine({ item }: { item: EvidenceItem }) {
  if (item.kind === "referral") {
    return (
      <div>
        <p className="text-sm leading-snug">{item.evidenceText}</p>
        <p className="mt-0.5 text-[11px] text-muted">
          <Badge tone="referral">referral</Badge> {item.evidenceType.replace("_", " ")} ·{" "}
          {SCALE_LABELS.conviction[item.conviction]} · {SCALE_LABELS.confidence[item.confidence]} ·{" "}
          {SCALE_LABELS.relationshipDepth[item.relationshipDepth]}
          {item.contributing ? "" : " · outside Top-K"} · {fmtDate(item.createdAt)}
        </p>
      </div>
    );
  }
  if (item.kind === "evaluation") {
    return (
      <div>
        <p className="text-sm leading-snug">{item.evidenceText}</p>
        <p className="mt-0.5 text-[11px] text-muted">
          <Badge tone="rubric">rubric</Badge> {item.dimensionLabel} ·{" "}
          {item.score === null
            ? PRODUCT_LANGUAGE.notObserved
            : `${item.score}/4 · ${item.scoreLabel}`}
          {item.confidence !== null ? ` · ${SCALE_LABELS.confidence[item.confidence]}` : ""} ·{" "}
          {fmtDate(item.createdAt)}
        </p>
      </div>
    );
  }
  return (
    <div>
      {item.evidenceText ? <p className="text-sm leading-snug">{item.evidenceText}</p> : null}
      <p className="mt-0.5 text-[11px] text-muted">
        <Badge tone="capability">compare</Badge> {item.dimensionLabel} ·{" "}
        {item.result.replace("_", " ")} vs {item.otherName} · {fmtDate(item.createdAt)}
      </p>
    </div>
  );
}

/** Compares without a note are tallied, not listed: the feed is about what judges said. */
function silentCompareSummary(items: EvidenceItem[]): string | null {
  const silent = items.filter((i) => i.kind === "comparison" && !i.evidenceText);
  if (silent.length === 0) return null;
  const tally = { won: 0, lost: 0, tie: 0, skip: 0, not_observed: 0 };
  for (const i of silent) if (i.kind === "comparison") tally[i.result]++;
  const parts = [
    tally.won ? `${tally.won} won` : "",
    tally.lost ? `${tally.lost} lost` : "",
    tally.tie ? `${tally.tie} tie` : "",
    tally.skip ? `${tally.skip} skipped` : "",
    tally.not_observed ? `${tally.not_observed} not observed` : "",
  ].filter(Boolean);
  return `${plural(silent.length, "compare")} without a note · ${parts.join(" · ")}`;
}

export function EvidenceByJudge({ groups }: { groups: JudgeEvidenceGroup[] }) {
  return (
    <Section
      title="Evidence by judge"
      hint="Every comment on this person, grouped by who wrote it. Judges with a track record come first."
    >
      {groups.length === 0 ? (
        <p className="text-sm text-muted">Nobody has written anything about this person yet.</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => {
            const comments = g.items.filter((i) => i.kind !== "comparison" || i.evidenceText);
            const silent = silentCompareSummary(g.items);
            return (
              <li key={g.judgeId} className="rounded-lg border border-line">
                <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</span>
                  <span className="text-[11px] text-muted">
                    {plural(comments.length, "comment")}
                  </span>
                  <TrackBadge track={g.trackRecord} />
                </div>
                <ul className="divide-y divide-line">
                  {comments.map((item) => (
                    <li key={item.id} className="px-3 py-2">
                      <ItemLine item={item} />
                    </li>
                  ))}
                  {silent ? <li className="px-3 py-1.5 text-[11px] text-muted">{silent}</li> : null}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function Referrals({ person }: { person: PersonView }) {
  return (
    <Section
      title="Why this signal exists"
      hint={`Incoming referrals. Strength R = X · m, Top-${Math.max(1, person.contributing.length)} contribute.`}
    >
      {person.referrals.length === 0 ? (
        <p className="text-sm text-muted">No incoming referrals.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {person.referrals.map((r) => (
            <li key={r.referralId} className="px-3 py-2">
              <p className="text-sm leading-snug">{r.evidenceText}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                <span className="font-medium text-ink">{r.referrerName}</span>
                <TrackBadge track={r.judgeTrackRecord} />
                <span>
                  {r.evidenceType.replace("_", " ")} · R <Num>{r.strength.toFixed(2)}</Num>
                  {r.contributing ? "" : " · outside Top-K"}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function StructuredEvidence({ person }: { person: PersonView }) {
  return (
    <Section title={PRODUCT_LANGUAGE.structuredEvidence} hint="Rubric observations, one row each.">
      {person.evaluations.length === 0 ? (
        <p className="text-sm text-muted">No rubric evaluations yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="caps text-muted">
            <tr className="text-left">
              <th className="py-1 font-medium">Evaluator</th>
              <th className="py-1 font-medium">Dimension</th>
              <th className="py-1 font-medium">Score</th>
              <th className="py-1 font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {person.evaluations.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  {e.evaluatorName} <TrackBadge track={e.trackRecord} />
                </td>
                <td className="py-1.5 pr-2 whitespace-nowrap text-secondary">{e.dimensionLabel}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  {e.score === null ? (
                    <span className="text-muted">{SCALE_LABELS.rubricNotObserved}</span>
                  ) : (
                    <>
                      <Num>{e.score}</Num>
                      <span className="text-muted">/4 · {e.scoreLabel}</span>
                    </>
                  )}
                </td>
                <td className="py-1.5 text-secondary">{e.evidenceText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function PairwiseHistory({ person }: { person: PersonView }) {
  return (
    <Section
      title="Pairwise history"
      hint="Comparisons involving this person. Skips never count against them."
    >
      {person.comparisonHistory.length === 0 ? (
        <p className="text-sm text-muted">Not compared yet.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {person.comparisonHistory.slice(0, 12).map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-2 py-1">
              <span className="w-32 shrink-0 text-secondary">{c.dimensionLabel}</span>
              <span
                className={
                  c.result === "won"
                    ? "text-ink"
                    : c.result === "lost"
                      ? "text-muted"
                      : "text-faint"
                }
              >
                {c.result.replace("_", " ")}
              </span>
              <span>vs {c.otherName}</span>
              <span className="text-[11px] text-muted">
                by {c.evaluatorName} · {fmtDate(c.createdAt)}
              </span>
              {c.evidenceText ? (
                <span className="w-full text-xs text-secondary">{c.evidenceText}</span>
              ) : null}
            </li>
          ))}
          {person.comparisonHistory.length > 12 ? (
            <li className="py-1 text-[11px] text-muted">
              and {person.comparisonHistory.length - 12} more
            </li>
          ) : null}
        </ul>
      )}
    </Section>
  );
}

export function Neighbourhood({
  person,
  onSelect,
}: {
  person: PersonView;
  onSelect: (id: string) => void;
}) {
  const list = (rows: PersonView["neighbourhood"]["referrers"], empty: string) =>
    rows.length === 0 ? (
      <p className="text-xs text-muted">{empty}</p>
    ) : (
      <ul className="flex flex-wrap gap-1.5">
        {rows.map((n) => (
          <li key={n.personId}>
            <button
              type="button"
              onClick={() => onSelect(n.personId)}
              className="press rounded-md border border-line px-2 py-0.5 text-xs hover:bg-subtle"
            >
              {n.name} <Num className="text-muted">{n.strength.toFixed(2)}</Num>
            </button>
          </li>
        ))}
      </ul>
    );
  return (
    <Section title="Referral neighbourhood" hint="Who referred them, and whom they referred.">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <p className="caps mb-1 text-muted">Referred by</p>
          {list(person.neighbourhood.referrers, "Nobody.")}
        </div>
        <div>
          <p className="caps mb-1 text-muted">Referred</p>
          {list(person.neighbourhood.referred, "Nobody.")}
        </div>
      </div>
      {person.gaps.some((g) => g.gap >= 25) ? (
        <p className="mt-3 text-xs text-gap">
          <Badge tone="gap">{PRODUCT_LANGUAGE.exploratory}</Badge>{" "}
          {PRODUCT_LANGUAGE.underRecognitionGap}:{" "}
          {person.gaps
            .filter((g) => g.gap >= 25)
            .map(
              (g) =>
                `${g.dimensionLabel} capability ${ordinal(g.capabilityPercentile)} vs referral ${ordinal(g.referralPercentile)} (+${Math.round(g.gap)})`,
            )
            .join(" · ")}
        </p>
      ) : null}
    </Section>
  );
}

export function DecisionHistory({
  snapshots,
  personId,
}: {
  snapshots: ClubSnapshot[];
  personId: string;
}) {
  const rows = snapshots.filter((s) => s.personId === personId);
  return (
    <Section
      title="Decision history"
      hint="What the council recorded, with the evidence at the time."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No decisions recorded for this person.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-2 py-1">
              <span className="font-medium">{s.decision.replace("_", " ")}</span>
              <span className="text-xs text-muted">
                {fmtDateTime(s.createdAt)} · {PRODUCT_LANGUAGE.referralSignal}{" "}
                {s.values.referralSignal === null
                  ? PRODUCT_LANGUAGE.insufficientEvidence
                  : s.values.referralSignal}{" "}
                · {s.values.incomingCount} incoming
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
