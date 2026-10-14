"use client";

import { useState } from "react";
import { DIMENSIONS, SCALE_LABELS } from "../../../../src/domain/constants.ts";
import type { Dimension, RubricScore, Scale5 } from "../../../../src/domain/types.ts";
import { dimensionLabel } from "../../../../src/inference/capabilityVector.ts";
import { FEEDBACK_TONE } from "../../lib/copy.ts";
import {
  type FeedbackInboxItem,
  type MemberResponseDraft,
  memberResponseFormError,
} from "../../lib/memberFeedback.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Field } from "../ui/Field.tsx";
import { Select, Textarea } from "../ui/Input.tsx";
import { Segmented } from "../ui/Segmented.tsx";

const SCORES: readonly RubricScore[] = [0, 1, 2, 3, 4];
const CONF: readonly Scale5[] = [1, 2, 3, 4, 5];

/** Pending and overdue asks for the signed-in member. */
export function FeedbackInbox({
  requests,
  loading,
  onRespond,
}: {
  requests: FeedbackInboxItem[];
  loading: boolean;
  onRespond: (draft: MemberResponseDraft) => Promise<string | null>;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="forum">
      {notice ? (
        <p role="status" className="mb-4 text-sm text-secondary">
          {notice}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-muted">Loading evaluations…</p> : null}
      {!loading && requests.length === 0 ? (
        <EmptyState title="No feedback requests waiting.">
          When the council asks you about someone, the request shows up here.
        </EmptyState>
      ) : null}
      <ul className="forum-list" aria-label="Feedback requests">
        {requests.map((request) => (
          <li key={request.id}>
            <FeedbackCard
              request={request}
              onRespond={async (draft) => {
                const error = await onRespond(draft);
                if (!error) setNotice("Response recorded.");
                return error;
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeedbackCard({
  request,
  onRespond,
}: {
  request: FeedbackInboxItem;
  onRespond: (draft: MemberResponseDraft) => Promise<string | null>;
}) {
  const [dimension, setDimension] = useState<Dimension>("problem_solving");
  const [score, setScore] = useState<RubricScore | null>(2);
  const [confidence, setConfidence] = useState<Scale5 | null>(3);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const overdue = request.state === "overdue";

  return (
    <article className="forum-post" aria-labelledby={`fb-${request.id}`}>
      <div className="forum-post-meta">
        <h2 id={`fb-${request.id}`} className="text-sm font-medium text-ink">
          {request.candidateName}
        </h2>
        <Badge tone={FEEDBACK_TONE[request.state]}>{overdue ? "Overdue" : "Pending"}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted">{request.dueLabel}</p>
      {request.note ? <p className="forum-post-body">{request.note}</p> : null}
      <form
        className="mt-3 space-y-2"
        aria-label={`Respond about ${request.candidateName}`}
        onSubmit={(event) => {
          event.preventDefault();
          const formError = memberResponseFormError(text);
          if (formError) {
            setError(formError);
            return;
          }
          setError(null);
          setBusy(true);
          void onRespond({
            requestId: request.id,
            dimension,
            score,
            confidence: score === null ? null : confidence,
            evidenceText: text,
          })
            .then((message) => {
              if (message) setError(message);
            })
            .finally(() => setBusy(false));
        }}
      >
        <p className="text-[11px] text-muted">
          Rubric evidence feeds no score. {SCALE_LABELS.rubricNotObserved} is a valid answer.
        </p>
        <Field label="Dimension">
          <Select
            value={dimension}
            onChange={(event) => setDimension(event.target.value as Dimension)}
          >
            {DIMENSIONS.map((item) => (
              <option key={item} value={item}>
                {dimensionLabel(item)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Score">
          <Segmented
            options={SCORES}
            value={score}
            onChange={setScore}
            captions={SCALE_LABELS.rubric}
            allowNone="N/O"
            disabled={busy}
          />
        </Field>
        {score !== null ? (
          <Field label="Confidence">
            <Segmented
              options={CONF}
              value={confidence}
              onChange={(value) => setConfidence(value)}
              captions={SCALE_LABELS.confidence}
              disabled={busy}
            />
          </Field>
        ) : null}
        <Field label="What did you observe?">
          <Textarea
            rows={3}
            value={text}
            aria-invalid={error ? true : undefined}
            disabled={busy}
            placeholder="Specific behaviour, not a verdict."
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? "Submitting…" : "Submit response"}
          </Button>
        </div>
      </form>
    </article>
  );
}
