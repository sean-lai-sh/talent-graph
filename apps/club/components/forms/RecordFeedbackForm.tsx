"use client";

import { useState } from "react";
import { DIMENSIONS, SCALE_LABELS } from "../../../../src/domain/constants.ts";
import type { Dimension, RubricScore, Scale5 } from "../../../../src/domain/types.ts";
import { dimensionLabel } from "../../../../src/inference/capabilityVector.ts";
import type {
  FeedbackView,
  MemberOption,
  PersonView,
  RecordFeedbackInput,
} from "../../lib/types.ts";
import { Button } from "../ui/Button.tsx";
import { Field, inputClass } from "../ui/Field.tsx";
import { Segmented } from "../ui/Segmented.tsx";

const SCORES: readonly RubricScore[] = [0, 1, 2, 3, 4];
const CONF: readonly Scale5[] = [1, 2, 3, 4, 5];

/** A member's answer, transcribed by the council: one rubric observation. */
export function RecordFeedbackForm({
  person,
  members,
  request,
  requiredDimensions,
  busy,
  onSubmit,
}: {
  person: PersonView;
  members: MemberOption[];
  request?: FeedbackView;
  requiredDimensions: Dimension[];
  busy: boolean;
  onSubmit: (input: RecordFeedbackInput) => void;
}) {
  const options = members.filter((m) => m.id !== person.id);
  const [evaluatorId, setEvaluatorId] = useState(request?.memberId ?? options[0]?.id ?? "");
  const [dimension, setDimension] = useState<Dimension>(requiredDimensions[0] ?? "problem_solving");
  const [score, setScore] = useState<RubricScore | null>(2);
  const [confidence, setConfidence] = useState<Scale5 | null>(3);
  const [text, setText] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!evaluatorId || text.trim() === "") return;
        onSubmit({
          ...(request ? { requestId: request.id } : {}),
          evaluatorId,
          candidateId: person.id,
          dimension,
          score,
          confidence: score === null ? null : confidence,
          evidenceText: text,
        });
        setText("");
      }}
    >
      <p className="text-sm font-medium">Record a member&apos;s response</p>
      <p className="text-[11px] text-muted">
        Rubric evidence feeds no score. {SCALE_LABELS.rubricNotObserved} is a valid answer.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Member">
          <select
            className={inputClass}
            value={evaluatorId}
            disabled={request !== undefined}
            onChange={(e) => setEvaluatorId(e.target.value)}
          >
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dimension">
          <select
            className={inputClass}
            value={dimension}
            onChange={(e) => setDimension(e.target.value as Dimension)}
          >
            {DIMENSIONS.map((d) => (
              <option key={d} value={d}>
                {dimensionLabel(d)}
                {requiredDimensions.includes(d) ? " · required" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
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
            onChange={(v) => setConfidence(v)}
            captions={SCALE_LABELS.confidence}
            disabled={busy}
          />
        </Field>
      ) : null}
      <Field label="What did they observe?">
        <textarea
          required
          rows={3}
          className={inputClass}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Specific behaviour, not a verdict."
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          Record
        </Button>
      </div>
    </form>
  );
}
