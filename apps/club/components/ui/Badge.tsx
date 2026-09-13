import type { ReactNode } from "react";
import type { Tone } from "../../lib/copy.ts";

const TONES: Record<Tone, string> = {
  neutral: "bg-raised text-secondary border-line",
  accent: "bg-accent-tint text-accent-text border-accent-tint",
  referral: "bg-referral-tint text-referral border-referral-tint",
  capability: "bg-capability-tint text-capability border-capability-tint",
  rubric: "bg-rubric-tint text-rubric border-rubric-tint",
  gap: "bg-gap-tint text-gap border-gap-tint",
  warn: "bg-warn-tint text-warn border-warn-tint",
  danger: "bg-danger-tint text-danger border-danger-tint",
  success: "bg-success-tint text-success border-success-tint",
};

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`caps inline-flex h-5 items-center whitespace-nowrap rounded border px-1.5 font-medium leading-none ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
