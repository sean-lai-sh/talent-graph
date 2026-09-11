"use client";

import { useState } from "react";
import type { PersonStatus, Scale5 } from "../../../../src/domain/types.ts";

export function ordinal(n: number): string {
  const v = Math.round(n);
  const mod10 = v % 10;
  const mod100 = v % 100;
  if (mod10 === 1 && mod100 !== 11) return `${v}st`;
  if (mod10 === 2 && mod100 !== 12) return `${v}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${v}rd`;
  return `${v}th`;
}

export function Scale({
  label,
  value,
  captions,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  value: Scale5;
  captions: Record<Scale5, string>;
  onChange?: (v: Scale5) => void;
  onCommit?: (v: Scale5) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<Scale5>(value);
  const [seen, setSeen] = useState<Scale5>(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  const set = (next: Scale5) => {
    setDraft(next);
    onChange?.(next);
  };

  const commit = () => {
    if (onCommit && draft !== value) onCommit(draft);
  };

  return (
    <label className="block text-xs">
      <span className="text-muted">
        {label} · {captions[draft]}
      </span>
      <input
        type="range"
        min={1}
        max={5}
        value={draft}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value) as Scale5)}
        onPointerUp={commit}
        onKeyUp={commit}
        className="mt-1 w-full accent-signal disabled:opacity-50"
      />
    </label>
  );
}

export function StatusChip({ status }: { status: PersonStatus }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
      {status}
    </span>
  );
}
