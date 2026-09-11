"use client";

import { useState } from "react";
import { TRACK_RECORD_COPY } from "../../../../src/judges/trackRecord.ts";
import { TRACK_RECORD_TONE } from "../../lib/copy.ts";
import { FEEDBACK_WINDOW_HOURS } from "../../lib/review.ts";
import type { MemberOption, PersonView, RequestFeedbackInput } from "../../lib/types.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Field, inputClass } from "../ui/Field.tsx";

export function RequestFeedbackForm({
  person,
  members,
  busy,
  onSubmit,
}: {
  person: PersonView;
  members: MemberOption[];
  busy: boolean;
  onSubmit: (input: RequestFeedbackInput) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const pendingIds = new Set(
    person.feedback.filter((f) => f.state !== "responded").map((f) => f.memberId),
  );
  const options = members.filter((m) => m.id !== person.id);
  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (picked.length === 0) return;
        onSubmit({ candidateId: person.id, memberIds: picked, note });
        setPicked([]);
        setNote("");
      }}
    >
      <p className="text-sm font-medium">Request feedback</p>
      <p className="text-[11px] text-muted">
        Members have {FEEDBACK_WINDOW_HOURS} hours. Their answer is a rubric evaluation and lands in
        Structured Evidence.
      </p>
      <ul className="scroll-thin max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-line p-1">
        {options.length === 0 ? (
          <li className="px-2 py-1 text-xs text-muted">Nobody to ask yet.</li>
        ) : (
          options.map((m) => {
            const pending = pendingIds.has(m.id);
            return (
              <li key={m.id}>
                <label
                  className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
                    pending ? "opacity-50" : "cursor-pointer hover:bg-subtle"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-ink"
                    disabled={pending}
                    checked={picked.includes(m.id)}
                    onChange={() => toggle(m.id)}
                  />
                  <span className="flex-1 truncate">{m.name}</span>
                  <Badge tone={TRACK_RECORD_TONE[m.trackRecord.label]}>
                    {pending ? "pending" : TRACK_RECORD_COPY[m.trackRecord.label]}
                  </Badge>
                </label>
              </li>
            );
          })
        )}
      </ul>
      <Field label="Note to the member">
        <textarea
          rows={2}
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What should they look at?"
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={busy || picked.length === 0}>
          Send request{picked.length > 1 ? `s (${picked.length})` : ""}
        </Button>
      </div>
    </form>
  );
}
