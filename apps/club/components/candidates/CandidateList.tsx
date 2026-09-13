"use client";

import { fmtDateShort, plural } from "../../lib/format.ts";
import type { CandidateRow } from "../../lib/types.ts";

function PeopleGroup({
  label,
  rows,
  selectedId,
  onSelect,
}: {
  label: string;
  rows: CandidateRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="group-label">
        {label} · {rows.length}
      </div>
      <ul className="people">
        {rows.map((row) => {
          const done = row.reviewStatus === "admitted" || row.reviewStatus === "denied";
          return (
            <li key={row.personId}>
              <button
                type="button"
                aria-current={row.personId === selectedId ? "true" : undefined}
                onClick={() => onSelect(row.personId)}
                className={`people-row row-hover s-${row.reviewStatus}${done ? " is-done" : ""}${
                  row.personId === selectedId ? " is-current" : ""
                }`}
              >
                <span className={`people-dot s-${row.reviewStatus}`} />
                <span className="nm">{row.name}</span>
                <time className="date" dateTime={row.createdAt} title={row.createdAt}>
                  {fmtDateShort(row.createdAt)}
                </time>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CandidateList({
  queue,
  decided,
  directory,
  query,
  selectedId,
  onQuery,
  onSelect,
}: {
  queue: CandidateRow[];
  decided: CandidateRow[];
  directory: CandidateRow[];
  query: string;
  selectedId: string | null;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
}) {
  const empty = queue.length === 0 && decided.length === 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="panel-search">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search applicants"
          aria-label="Search applicants"
        />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {empty ? (
          <p className="empty-note px-3 py-6">
            {query.trim() ? "No one by that name." : "Nobody to review."}
          </p>
        ) : (
          <>
            <PeopleGroup
              label="Needs review"
              rows={queue}
              selectedId={selectedId}
              onSelect={onSelect}
            />
            <PeopleGroup
              label="Decided"
              rows={decided}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </>
        )}
      </div>
      <div className="panel-foot">
        {plural(directory.length, "applicant")} ·{" "}
        {
          directory.filter((r) => r.reviewStatus === "admitted" || r.reviewStatus === "denied")
            .length
        }{" "}
        decided
      </div>
    </div>
  );
}
