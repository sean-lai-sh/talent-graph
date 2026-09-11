"use client";

import { useState } from "react";
import { REVIEW_STATUS_TONE } from "../../lib/copy.ts";
import { availableDecisions, DECISION_COPY, REVIEW_STATUS_COPY } from "../../lib/review.ts";
import type {
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
import { Sheet } from "../ui/Sheet.tsx";
import { ChannelSummary } from "./ChannelSummary.tsx";
import { ComparisonsPane, Reviews } from "./Evidence.tsx";

const DECISION_VARIANT: Record<Decision, "primary" | "secondary" | "danger" | "ghost"> = {
  start_review: "secondary",
  admit: "primary",
  deny: "danger",
  request_data: "secondary",
  reopen: "secondary",
};

const AFTER_READING: ReadonlySet<Decision> = new Set(["admit", "deny", "reopen"]);

export function CaseView({
  person,
  members,
  config,
  clock,
  busy,
  present,
  canDecide,
  onDecide,
  onRequestFeedback,
  onRecordFeedback,
  onBack,
}: {
  person: PersonView;
  members: MemberOption[];
  config: ReviewConfig;
  clock: IsoDate;
  busy: boolean;
  present: boolean;
  canDecide: boolean;
  onDecide: (decision: Decision) => void;
  onRequestFeedback: (input: RequestFeedbackInput) => void;
  onRecordFeedback: (input: RecordFeedbackInput) => void;
  onBack: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [recording, setRecording] = useState<FeedbackView | null>(null);
  const decisions = availableDecisions(person.reviewStatus).filter((d) => AFTER_READING.has(d));

  return (
    <article
      className={`mx-auto w-full ${present ? "max-w-5xl px-8 py-8" : "max-w-4xl px-6 py-5"}`}
    >
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
        {(person.linkedin || person.resume || person.phone) && (
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-secondary">
            {person.linkedin ? (
              <a
                href={
                  person.linkedin.startsWith("http")
                    ? person.linkedin
                    : `https://${person.linkedin}`
                }
                target="_blank"
                rel="noreferrer"
                className="press hover:text-ink"
              >
                LinkedIn
              </a>
            ) : null}
            {person.resume ? (
              <a
                href={person.resume.startsWith("http") ? person.resume : `https://${person.resume}`}
                target="_blank"
                rel="noreferrer"
                className="press hover:text-ink"
              >
                Resume
              </a>
            ) : null}
            {person.phone ? <span>{person.phone}</span> : null}
          </p>
        )}
      </div>

      <div className="mt-5">
        <ChannelSummary person={person} />
      </div>

      <div className="mt-6">
        <Reviews
          person={person}
          clock={clock}
          onAsk={() => setAsking(true)}
          onCompare={() => setComparing(true)}
          onRecord={(f) => setRecording(f)}
        />
      </div>

      {recording ? (
        <div className="mt-4 rounded-lg border border-line bg-subtle p-3">
          <RecordFeedbackForm
            person={person}
            members={members}
            requiredDimensions={config.requiredDimensions}
            request={recording}
            busy={busy}
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

      {decisions.length > 0 ? (
        <div
          className={`mt-8 flex flex-wrap items-center gap-2 border-t border-line pt-4 ${
            present ? "sticky bottom-0 -mx-8 bg-canvas/95 px-8 py-3 backdrop-blur" : ""
          }`}
        >
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
        </div>
      ) : null}

      <Sheet open={asking} title="Ask someone" onClose={() => setAsking(false)}>
        <RequestFeedbackForm
          person={person}
          members={members}
          busy={busy}
          onSubmit={(input) => {
            onRequestFeedback(input);
            setAsking(false);
          }}
        />
      </Sheet>
      <Sheet open={comparing} title="Comparisons" onClose={() => setComparing(false)}>
        <ComparisonsPane person={person} />
      </Sheet>
    </article>
  );
}
