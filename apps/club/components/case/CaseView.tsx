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
import { ChannelSummary, StatTiles } from "./ChannelSummary.tsx";
import { Activity, AlsoVouched, CommitteeNotes, ComparisonsPane, Reviews } from "./Evidence.tsx";

const AFTER_READING: ReadonlySet<Decision> = new Set(["admit", "deny", "reopen"]);

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
        <h1 className="mt-2 text-[clamp(1.5rem,2.8vw,2.125rem)] font-semibold leading-[1.08] tracking-tight">
          {person.name}
        </h1>
        <p className="blurb mt-3 max-w-[56ch] text-muted">{blurb || "No summary written yet."}</p>
        {(person.linkedin || person.resume || person.phone) && (
          <div className="ident-links">
            {person.linkedin ? (
              <a
                href={
                  person.linkedin.startsWith("http")
                    ? person.linkedin
                    : `https://${person.linkedin}`
                }
                target="_blank"
                rel="noreferrer"
              >
                LinkedIn
              </a>
            ) : null}
            {person.resume ? (
              <a
                href={person.resume.startsWith("http") ? person.resume : `https://${person.resume}`}
                target="_blank"
                rel="noreferrer"
              >
                Résumé
              </a>
            ) : null}
            {person.phone ? <span>{person.phone}</span> : null}
          </div>
        )}
      </header>

      <div className="board">
        <div className="board-side">
          <ChannelSummary person={person} people={people} />
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
        <div className="board-lane">
          <StatTiles person={person} people={people} />
          <Reviews
            person={person}
            clock={clock}
            onAsk={() => setAsking(true)}
            onCompare={() => setComparing(true)}
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
          <div className="duo">
            <AlsoVouched person={person} people={people} />
            <Activity person={person} />
          </div>
        </div>
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
