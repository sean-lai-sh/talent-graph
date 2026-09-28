"use client";

import type { ReactNode } from "react";
import { EMPTY_OBSERVATION_ERROR } from "../../lib/memberReferral.ts";
import {
  Q1_CONTEXTS,
  Q1_LENGTH,
  Q1_LENGTH_CHOICES,
  Q1_STAKE,
  Q1_STAKES,
  Q2_HARD,
  Q2_ROLES,
  Q2_SOFT_LIMIT,
  Q2_WHAT,
  Q3_CONTEXT_PENDING,
  Q3_GROUP_CHOICES,
  Q3_RANKS,
  type QuestionDraft,
  q1Know,
  q2Distinct,
  q2Prompt,
  q2Role,
  q3Group,
  q3Rank,
} from "../../lib/referralQuestions.ts";
import type { ReferralQ1Stake } from "../../lib/types.ts";
import { Button } from "../ui/Button.tsx";

function Chip({
  pressed,
  disabled,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`press rounded-full border px-3 py-1 text-sm ${
        pressed
          ? "border-ink bg-ink text-canvas"
          : "border-line bg-raised text-secondary hover:bg-subtle hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ChipRow({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

export function ReferralQuestions({
  name,
  draft,
  onChange,
  locked,
  busy,
  error,
  onBack,
  onContinue,
}: {
  name: string;
  draft: QuestionDraft;
  onChange: (draft: QuestionDraft) => void;
  locked: boolean;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  const observationEmpty =
    error === EMPTY_OBSERVATION_ERROR &&
    (draft.what.trim() === "" || draft.hard.trim() === "" || draft.distinct.trim() === "");

  function toggleStake(stake: ReferralQ1Stake) {
    const stakes = draft.stakes.includes(stake)
      ? draft.stakes.filter((item) => item !== stake)
      : [...draft.stakes, stake];
    onChange({ ...draft, stakes });
  }

  return (
    <form
      className="mx-auto max-w-2xl space-y-6 px-6 py-8"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        onContinue();
      }}
    >
      <p className="text-xs tracking-wide text-muted">STEP 3 OF 4</p>
      <div className="space-y-4">
        <ChipRow legend={q1Know(name)}>
          {Q1_CONTEXTS.map((option) => (
            <Chip
              key={option}
              pressed={draft.context === option}
              disabled={locked || busy}
              onClick={() => onChange({ ...draft, context: option })}
            >
              {option}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow legend={Q1_LENGTH}>
          {Q1_LENGTH_CHOICES.map((option) => (
            <Chip
              key={option.value}
              pressed={draft.length === option.value}
              disabled={locked || busy}
              onClick={() => onChange({ ...draft, length: option.value })}
            >
              {option.label}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow legend={Q1_STAKE}>
          {Q1_STAKES.map((option) => (
            <Chip
              key={option}
              pressed={draft.stakes.includes(option)}
              disabled={locked || busy}
              onClick={() => toggleStake(option)}
            >
              {option}
            </Chip>
          ))}
        </ChipRow>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-ink">{q2Prompt(name)}</h2>
        {(
          [
            [Q2_WHAT, "what"],
            [Q2_HARD, "hard"],
            [q2Distinct(name), "distinct"],
          ] as const
        ).map(([label, field]) => (
          <label key={field} className="block">
            <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
            <textarea
              value={draft[field]}
              disabled={locked || busy}
              maxLength={Q2_SOFT_LIMIT}
              rows={3}
              aria-invalid={observationEmpty && draft[field].trim() === "" ? true : undefined}
              onChange={(event) => onChange({ ...draft, [field]: event.target.value })}
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-faint"
            />
            <span className="mt-1 block text-[11px] text-muted">
              {draft[field].length}/{Q2_SOFT_LIMIT}
            </span>
          </label>
        ))}
        <ChipRow legend={q2Role(name)}>
          {Q2_ROLES.map((option) => (
            <Chip
              key={option}
              pressed={draft.role === option}
              disabled={locked || busy}
              onClick={() => onChange({ ...draft, role: option })}
            >
              {option}
            </Chip>
          ))}
        </ChipRow>
      </div>

      <div className="space-y-4">
        <ChipRow legend={q3Group(draft.context ?? Q3_CONTEXT_PENDING)}>
          {Q3_GROUP_CHOICES.map((option) => (
            <Chip
              key={option.value}
              pressed={draft.groupSize === option.value}
              disabled={locked || busy}
              onClick={() => onChange({ ...draft, groupSize: option.value })}
            >
              {option.label}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow legend={q3Rank(name)}>
          {Q3_RANKS.map((option) => (
            <Chip
              key={option}
              pressed={draft.rank === option}
              disabled={locked || busy}
              onClick={() => onChange({ ...draft, rank: option })}
            >
              {option}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {locked ? <p className="text-xs text-muted">These answers are saved.</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
          Back
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          Continue
        </Button>
      </div>
    </form>
  );
}
