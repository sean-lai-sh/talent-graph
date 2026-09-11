"use client";

import { useState } from "react";
import { REVIEW_STATUS_TONE } from "../../lib/copy.ts";
import { daysLabel, fmtDate } from "../../lib/format.ts";
import { availableDecisions, DECISION_COPY, REVIEW_STATUS_COPY } from "../../lib/review.ts";
import type {
  ClubSnapshot,
  Decision,
  FeedbackView,
  IsoDate,
  MemberOption,
  PersonView,
  RecordFeedbackInput,
  RequestFeedbackInput,
  ReviewConfig,
} from "../../lib/types.ts";
import { RecordFeedbackForm } from "../forms/RecordFeedbackForm.tsx";
import { RequestFeedbackForm } from "../forms/RequestFeedbackForm.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Popover } from "../ui/Popover.tsx";
import { ChannelSummary } from "./ChannelSummary.tsx";
import {
  DecisionHistory,
  EvidenceByJudge,
  FeedbackRequests,
  MissingEvidence,
  Neighbourhood,
  PairwiseHistory,
  QueueNote,
  Referrals,
  StructuredEvidence,
} from "./Evidence.tsx";

const DECISION_VARIANT: Record<Decision, "primary" | "secondary" | "danger" | "ghost"> = {
  start_review: "secondary",
  admit: "primary",
  deny: "danger",
  request_data: "secondary",
  reopen: "secondary",
};

export function CaseView({
  person,
  members,
  config,
  snapshots,
  clock,
  busy,
  present,
  canDecide,
  onDecide,
  onRequestFeedback,
  onRecordFeedback,
  onSelect,
  onBack,
}: {
  person: PersonView;
  members: MemberOption[];
  config: ReviewConfig;
  snapshots: ClubSnapshot[];
  clock: IsoDate;
  busy: boolean;
  present: boolean;
  canDecide: boolean;
  onDecide: (decision: Decision) => void;
  onRequestFeedback: (input: RequestFeedbackInput) => void;
  onRecordFeedback: (input: RecordFeedbackInput) => void;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const [recording, setRecording] = useState<FeedbackView | null | "free">(null);
  const decisions = availableDecisions(person.reviewStatus);

  const decisionBar = (
    <div className="flex flex-wrap items-center gap-2">
      {decisions.map((d) => (
        <Button
          key={d}
          variant={DECISION_VARIANT[d]}
          disabled={busy || !canDecide}
          onClick={() => onDecide(d)}
        >
          {DECISION_COPY[d]}
        </Button>
      ))}
      <Popover label="Request feedback" align="left" width="w-96">
        {(close) => (
          <RequestFeedbackForm
            person={person}
            members={members}
            busy={busy}
            onSubmit={(input) => {
              onRequestFeedback(input);
              close();
            }}
          />
        )}
      </Popover>
      <Button variant="ghost" onClick={() => setRecording("free")}>
        Record a response
      </Button>
    </div>
  );

  return (
    <article
      className={`mx-auto w-full ${present ? "max-w-5xl px-8 py-8" : "max-w-4xl px-6 py-5"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="press mb-1 text-xs text-secondary hover:text-ink md:hidden"
          >
            ← All candidates
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={`${present ? "text-3xl" : "text-2xl"} font-semibold tracking-tight`}>
              {person.name}
            </h2>
            <Badge tone={REVIEW_STATUS_TONE[person.reviewStatus]}>
              {REVIEW_STATUS_COPY[person.reviewStatus]}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-secondary">
            {person.affiliation || "Unaffiliated"}
            {person.bio ? ` · ${person.bio}` : ""}
          </p>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
            <div>
              <dt className="inline">Phone </dt>
              <dd className="inline text-ink">{person.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline">LinkedIn </dt>
              <dd className="inline text-ink">{person.linkedin ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline">In current stage </dt>
              <dd className="inline text-ink">{daysLabel(person.daysInReview)}</dd>
            </div>
            <div>
              <dt className="inline">Added </dt>
              <dd className="inline text-ink">{fmtDate(person.createdAt)}</dd>
            </div>
          </dl>
        </div>
        {!present ? decisionBar : null}
      </div>

      <div className="mt-3">
        <QueueNote person={person} />
      </div>

      <div className="mt-4">
        <p className="caps mb-2 text-muted">Case summary · three channels, never one number</p>
        <ChannelSummary person={person} />
      </div>

      {recording !== null ? (
        <div className="mt-4 rounded-lg border border-line bg-subtle p-3">
          <RecordFeedbackForm
            person={person}
            members={members}
            requiredDimensions={config.requiredDimensions}
            busy={busy}
            {...(recording !== "free" ? { request: recording } : {})}
            onSubmit={(input) => {
              onRecordFeedback(input);
              setRecording(null);
            }}
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setRecording(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 space-y-5">
        <MissingEvidence
          person={person}
          onAsk={(memberId) =>
            onRequestFeedback({ candidateId: person.id, memberIds: [memberId], note: "" })
          }
        />
        <FeedbackRequests person={person} clock={clock} onRecord={(f) => setRecording(f)} />
        <EvidenceByJudge groups={person.judgeEvidence} />
        <Referrals person={person} />
        <StructuredEvidence person={person} />
        <PairwiseHistory person={person} />
        <Neighbourhood person={person} onSelect={onSelect} />
        <DecisionHistory snapshots={snapshots} personId={person.id} />
      </div>

      {present ? (
        <div className="sticky bottom-0 mt-6 -mx-8 border-t border-line bg-canvas/95 px-8 py-3 backdrop-blur">
          {decisionBar}
        </div>
      ) : null}
    </article>
  );
}
