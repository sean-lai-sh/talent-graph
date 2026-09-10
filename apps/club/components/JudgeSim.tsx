"use client";

import { useMemo, useState } from "react";
import { PRODUCT_LANGUAGE } from "../../../src/domain/constants.ts";
import type { ClubView, TimelineFrame } from "../lib/types.ts";

function nearestIndex(timeline: TimelineFrame[], now: string): number {
  const t = new Date(now).getTime();
  let best = 0;
  let dist = Number.POSITIVE_INFINITY;
  timeline.forEach((frame, i) => {
    const d = Math.abs(new Date(frame.now).getTime() - t);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

export function JudgeSim({
  view,
  busy,
  onPickTime,
  onSelectJudge,
}: {
  view: ClubView;
  busy: boolean;
  onPickTime: (now: string) => void;
  onSelectJudge?: (id: string) => void;
}) {
  const committed = useMemo(() => nearestIndex(view.timeline, view.now), [view.timeline, view.now]);
  const [draft, setDraft] = useState(committed);
  const [seen, setSeen] = useState(committed);
  if (committed !== seen) {
    setSeen(committed);
    setDraft(committed);
  }
  const frame = view.timeline[draft] ?? view.timeline[committed];
  const first = view.timeline[0];
  const last = view.timeline[view.timeline.length - 1];

  if (!frame || !first || !last) {
    return <p className="text-sm text-muted">No timeline on this club.</p>;
  }

  return (
    <div className={busy ? "opacity-70" : ""}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Judge calibration over T</h2>
          <p className="mt-1 max-w-xl text-[11px] text-muted">
            Each tick reruns judge calibration on this club, including slider edits. Before the{" "}
            {view.observationWindowDays}-day window, every judge is 1 and V2 equals V0. After it,
            weights move and Referral Signal can shift.
          </p>
        </div>
        <p className="font-mono text-xs text-muted">
          T {frame.now.slice(0, 10)} · {frame.evaluatedReferrals} evaluated ·{" "}
          {frame.judgesWithEvidence} judges
        </p>
      </div>

      <label className="mt-3 block">
        <span className="sr-only">Evaluation time T</span>
        <input
          type="range"
          min={0}
          max={view.timeline.length - 1}
          value={draft}
          disabled={busy}
          data-clock={frame.now}
          onInput={(e) => setDraft(Number(e.currentTarget.value))}
          onChange={(e) => setDraft(Number(e.currentTarget.value))}
          onPointerUp={(e) => {
            const next = view.timeline[Number(e.currentTarget.value)];
            if (next && next.now !== view.now) onPickTime(next.now);
          }}
          onKeyUp={(e) => {
            const next = view.timeline[Number(e.currentTarget.value)];
            if (next && next.now !== view.now) onPickTime(next.now);
          }}
          className="w-full accent-signal disabled:opacity-50"
        />
        <span className="mt-1 flex justify-between text-[10px] text-muted">
          <span>{first.now.slice(0, 7)}</span>
          <span>
            {frame.windowOpen ? "window open · V2 can differ" : "window closed · V2 = V0"}
          </span>
          <span>{last.now.slice(0, 10)}</span>
        </span>
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {frame.personas.map((p) => {
          if (p.v0 === null || p.v2 === null) {
            return (
              <div key={p.id} className="rounded border border-line px-2 py-1.5 text-xs">
                <p className="truncate">{p.name}</p>
                <p className="text-muted">{PRODUCT_LANGUAGE.insufficientEvidence}</p>
              </div>
            );
          }
          const delta = p.v2 - p.v0;
          return (
            <div key={p.id} className="rounded border border-line px-2 py-1.5 text-xs">
              <p className="truncate">{p.name}</p>
              <p className="font-mono text-muted">
                {p.v0}
                {delta === 0 ? (
                  <span> = {p.v2}</span>
                ) : (
                  <span className="text-signal">
                    {" "}
                    → {p.v2} ({delta > 0 ? "+" : ""}
                    {delta})
                  </span>
                )}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-3 space-y-1">
        {frame.judges.slice(0, 8).map((j) => (
          <div key={j.judgeId} className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-left hover:underline"
              onClick={() => onSelectJudge?.(j.judgeId)}
            >
              {j.name}
            </button>
            <span className="font-mono text-xs text-muted">
              p̂ {j.reliability.toFixed(2)}
              {j.meanSquaredError !== null ? ` · Ē ${j.meanSquaredError.toFixed(3)}` : ""} ·{" "}
              {j.evaluatedCount} evaluated
            </span>
          </div>
        ))}
        {frame.judges.length === 0 ? (
          <p className="text-sm text-muted">No judges have cleared the observation window yet.</p>
        ) : null}
      </div>
    </div>
  );
}
