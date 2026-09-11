"use client";

import { useState } from "react";
import { PRODUCT_LANGUAGE } from "../../../../src/domain/constants.ts";
import { REVIEW_STATUS_TONE } from "../../lib/copy.ts";
import { relativeRankText } from "../../lib/format.ts";
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
import { ComparisonsPane, DecisionContext, NeighbourhoodPane, Reviews } from "./Evidence.tsx";

const DECISION_VARIANT: Record<Decision, "primary" | "secondary" | "danger" | "ghost"> = {
  start_review: "secondary",
  admit: "primary",
  deny: "danger",
  request_data: "ghost",
  reopen: "secondary",
};

const PRIMARY = new Set<Decision>(["admit", "deny"]);

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
  const [recording, setRecording] = useState<FeedbackView | null>(null);
  const decisions = availableDecisions(person.reviewStatus);
  const primary = decisions.filter((d) => PRIMARY.has(d));
  const secondary = decisions.filter((d) => !PRIMARY.has(d));
  const ranks = person.dimensions.filter(
    (d) => d.state === "estimated" && d.percentile !== null && d.poolSize !== null,
  );

  return (
    <article
      className={`relative mx-auto w-full pb-24 ${present ? "max-w-5xl px-8 py-8" : "max-w-4xl px-6 py-5"}`}
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
        <p className="mt-3 text-sm">
          {ranks.length > 0 ? (
            ranks.map((d, i) => (
              <span key={d.dimension} className={d.required ? "text-ink" : "text-secondary"}>
                {i > 0 ? <span className="text-muted"> · </span> : null}
                {relativeRankText(d.percentile, d.poolSize, d.label)}
              </span>
            ))
          ) : (
            <span className="insufficient">{PRODUCT_LANGUAGE.insufficientEvidence}</span>
          )}
        </p>
      </div>

      <div className="mt-6">
        <Reviews
          person={person}
          clock={clock}
          openByDefault
          onAsk={() => setAsking(true)}
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

      <details className="mt-8 border-t border-line pt-4">
        <summary className="press cursor-pointer text-sm font-medium text-secondary hover:text-ink">
          More
        </summary>
        <div className="mt-4 space-y-8">
          <ChannelSummary person={person} />
          <NeighbourhoodPane person={person} />
          <ComparisonsPane person={person} />
          <DecisionContext person={person} />
        </div>
      </details>

      <div
        className={`sticky bottom-0 z-10 mt-8 flex flex-wrap items-center gap-2 border-t border-line bg-canvas/95 py-3 backdrop-blur ${
          present ? "-mx-8 px-8" : "-mx-6 px-6"
        }`}
      >
        {(primary.length > 0 ? primary : secondary).map((d) => (
          <Button
            key={d}
            variant={DECISION_VARIANT[d]}
            disabled={busy || !canDecide}
            onClick={() => onDecide(d)}
          >
            {DECISION_COPY[d]}
          </Button>
        ))}
        {primary.length > 0
          ? secondary.map((d) => (
              <Button
                key={d}
                variant={DECISION_VARIANT[d]}
                size="sm"
                disabled={busy || !canDecide}
                onClick={() => onDecide(d)}
              >
                {d === "request_data" ? "Need more" : DECISION_COPY[d]}
              </Button>
            ))
          : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(true)}>
          Request feedback
        </Button>
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
    </article>
  );
}
