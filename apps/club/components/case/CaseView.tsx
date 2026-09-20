"use client";

import { useState } from "react";
import { availableDecisions, REVIEW_STATUS_COPY } from "../../lib/review.ts";
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
import { Button } from "../ui/Button.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { ChannelSummary } from "./ChannelSummary.tsx";
import { CommitteeNotes, ComparisonsPane, Reviews } from "./Evidence.tsx";

const AFTER_READING: ReadonlySet<Decision> = new Set(["admit", "deny", "reopen"]);

function hrefOf(value: string): string {
  return value.startsWith("http") ? value : `https://${value}`;
}

function LinkedInMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.23 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.73V1.73C24 .77 23.21 0 22.23 0z"
      />
    </svg>
  );
}

function ResumeMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 3.75h5.25L18.5 9v11.25H8A1.75 1.75 0 0 1 6.25 18.5V5.5A1.75 1.75 0 0 1 8 3.75Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M13.25 3.75V9H18.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9.5 13h5M9.5 16.25h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CaseView({
  person,
  people,
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
  people: PersonView[];
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
  const blurb = [person.affiliation, person.bio].filter(Boolean).join(". ");

  return (
    <article className={`case-sheet ${present ? "w-full max-w-none" : ""}`}>
      <header className="ident mb-6">
        <button
          type="button"
          onClick={onBack}
          className="press mb-3 text-xs text-secondary hover:text-ink lg:hidden"
        >
          ← All candidates
        </button>
        <div className={`status-kicker s-${person.reviewStatus}`}>
          {REVIEW_STATUS_COPY[person.reviewStatus]}
        </div>
        <div className="ident-row">
          <h1 className="text-[clamp(1.5rem,2.8vw,2.125rem)] font-semibold leading-[1.08] tracking-tight">
            {person.name}
          </h1>
          {(person.linkedin || person.resume) && (
            <div className="ident-logos">
              {person.linkedin ? (
                <a
                  href={hrefOf(person.linkedin)}
                  target="_blank"
                  rel="noreferrer"
                  className="ident-logo"
                  aria-label="LinkedIn"
                >
                  <LinkedInMark />
                </a>
              ) : null}
              {person.resume ? (
                <a
                  href={hrefOf(person.resume)}
                  target="_blank"
                  rel="noreferrer"
                  className="ident-logo"
                  aria-label="Résumé"
                >
                  <ResumeMark />
                </a>
              ) : null}
            </div>
          )}
        </div>
        <p className="blurb mt-3 max-w-[56ch] text-muted">{blurb || "No summary written yet."}</p>
        {person.phone ? <p className="ident-phone">{person.phone}</p> : null}
      </header>

      <div className="board">
        <ChannelSummary person={person} people={people} onCompare={() => setComparing(true)} />
        <Reviews
          person={person}
          clock={clock}
          onAsk={() => setAsking(true)}
          onRecord={(f) => setRecording(f)}
        />
        {recording ? (
          <div className="card">
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
        <CommitteeNotes person={person} />
        {decisions.length > 0 ? (
          <div className="decide">
            {decisions.includes("admit") ? (
              <button
                type="button"
                className="admit press"
                disabled={busy || !canDecide}
                onClick={() => onDecide("admit")}
              >
                Admit
              </button>
            ) : null}
            {decisions.includes("deny") ? (
              <button
                type="button"
                className="deny press"
                disabled={busy || !canDecide}
                onClick={() => onDecide("deny")}
              >
                Deny
              </button>
            ) : null}
            {decisions.includes("reopen") ? (
              <button
                type="button"
                className="reopen press"
                disabled={busy || !canDecide}
                onClick={() => onDecide("reopen")}
              >
                Reopen
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

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
