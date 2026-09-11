"use client";

import {
  REVIEW_BUCKET_COPY,
  REVIEW_BUCKET_ORDER,
  type ReviewBucket,
} from "../../../../src/analysis/reviewQueue.ts";
import { DIMENSIONS, PRODUCT_LANGUAGE } from "../../../../src/domain/constants.ts";
import type { Dimension } from "../../../../src/domain/types.ts";
import { dimensionLabel } from "../../../../src/inference/capabilityVector.ts";
import { BUCKET_TONE, REVIEW_STATUS_TONE } from "../../lib/copy.ts";
import { ordinal, signalText } from "../../lib/format.ts";
import { REVIEW_STATUS_COPY, REVIEW_STATUS_ORDER } from "../../lib/review.ts";
import type { SortDir } from "../../lib/tableModel.ts";
import type { CandidateRow, ReviewStatus } from "../../lib/types.ts";
import { Badge } from "../ui/Badge.tsx";
import { Num } from "../ui/Num.tsx";

export type SortKey =
  | "name"
  | "status"
  | "signal"
  | "incoming"
  | "dimension"
  | "rubric"
  | "days"
  | "created";

export interface ListFilters {
  statuses: ReviewStatus[];
  bucket: ReviewBucket | "all";
  dimension: Dimension;
  overdueOnly: boolean;
  query: string;
}

export const DEFAULT_FILTERS: ListFilters = {
  statuses: ["new", "under_review", "needs_data"],
  bucket: "all",
  dimension: "problem_solving",
  overdueOnly: false,
  query: "",
};

export const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  status: "Status",
  signal: PRODUCT_LANGUAGE.referralSignal,
  incoming: "Incoming",
  dimension: "Dimension percentile",
  rubric: "Rubric evaluations",
  days: "Days in review",
  created: "Created",
};

export function CandidateList({
  rows,
  total,
  filters,
  sort,
  selectedId,
  onFilters,
  onSort,
  onSelect,
}: {
  rows: CandidateRow[];
  total: number;
  filters: ListFilters;
  sort: { key: SortKey; dir: SortDir };
  selectedId: string | null;
  onFilters: (next: ListFilters) => void;
  onSort: (next: { key: SortKey; dir: SortDir }) => void;
  onSelect: (id: string) => void;
}) {
  const toggleStatus = (s: ReviewStatus) =>
    onFilters({
      ...filters,
      statuses: filters.statuses.includes(s)
        ? filters.statuses.filter((x) => x !== s)
        : [...filters.statuses, s],
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line px-3 py-2">
        <input
          type="search"
          placeholder="Search candidates"
          value={filters.query}
          onChange={(e) => onFilters({ ...filters, query: e.target.value })}
          className="h-7 w-full rounded-md border border-line bg-surface px-2 text-xs placeholder:text-faint"
        />
        <div className="flex flex-wrap gap-1">
          {REVIEW_STATUS_ORDER.map((s) => {
            const on = filters.statuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggleStatus(s)}
                className={`press caps rounded border px-1.5 py-0.5 ${
                  on
                    ? "border-ink bg-ink text-canvas"
                    : "border-line text-secondary hover:bg-subtle"
                }`}
              >
                {REVIEW_STATUS_COPY[s]}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <select
            aria-label="Queue bucket"
            value={filters.bucket}
            onChange={(e) =>
              onFilters({ ...filters, bucket: e.target.value as ListFilters["bucket"] })
            }
            className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs"
          >
            <option value="all">Any evidence state</option>
            {REVIEW_BUCKET_ORDER.map((b) => (
              <option key={b} value={b}>
                {REVIEW_BUCKET_COPY[b].label}
              </option>
            ))}
          </select>
          <select
            aria-label="Capability dimension shown"
            value={filters.dimension}
            onChange={(e) => onFilters({ ...filters, dimension: e.target.value as Dimension })}
            className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs"
          >
            {DIMENSIONS.map((d) => (
              <option key={d} value={d}>
                {dimensionLabel(d)}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort by"
            value={sort.key}
            onChange={(e) => onSort({ ...sort, key: e.target.value as SortKey })}
            className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                Sort: {SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSort({ ...sort, dir: sort.dir === "asc" ? "desc" : "asc" })}
              className="press h-7 rounded-md border border-line bg-surface px-2 text-xs text-secondary hover:bg-subtle"
              title="Toggle sort direction"
            >
              {sort.dir === "asc" ? "Ascending" : "Descending"}
            </button>
            <label className="flex items-center gap-1 text-[11px] text-secondary">
              <input
                type="checkbox"
                className="accent-ink"
                checked={filters.overdueOnly}
                onChange={(e) => onFilters({ ...filters, overdueOnly: e.target.checked })}
              />
              overdue
            </label>
          </div>
        </div>
        <p className="text-[11px] text-muted">
          <Num>{rows.length}</Num> of <Num>{total}</Num> · {dimensionLabel(filters.dimension)}{" "}
          column shows the percentile in its own pool
        </p>
      </div>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto" aria-label="Candidates">
        {rows.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-muted">No candidates match.</li>
        ) : (
          rows.map((row) => (
            <Row
              key={row.personId}
              row={row}
              dimension={filters.dimension}
              selected={row.personId === selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function Row({
  row,
  dimension,
  selected,
  onSelect,
}: {
  row: CandidateRow;
  dimension: Dimension;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const est = row.estimated[dimension];
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(row.personId)}
        className={`row-hover block w-full border-b border-line px-3 py-2 text-left ${
          selected ? "bg-accent-tint" : ""
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
          {row.overdueFeedback > 0 ? (
            <span className="h-1.5 w-1.5 rounded-full bg-danger" title="Overdue feedback" />
          ) : row.pendingFeedback > 0 ? (
            <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Feedback pending" />
          ) : null}
          <Badge tone={REVIEW_STATUS_TONE[row.reviewStatus]}>
            {REVIEW_STATUS_COPY[row.reviewStatus]}
          </Badge>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
          <span className="min-w-0 flex-1 truncate">{row.affiliation || "—"}</span>
          {row.bucket ? (
            <Badge tone={BUCKET_TONE[row.bucket]}>{REVIEW_BUCKET_COPY[row.bucket].label}</Badge>
          ) : null}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
          <span className="text-referral">
            {row.v2Signal === null ? (
              <span className="insufficient">{signalText(null)}</span>
            ) : (
              <>
                <Num>{row.v2Signal}</Num>
                <span className="text-muted"> · {row.incomingCount} in</span>
              </>
            )}
          </span>
          <span className="text-capability">
            {est ? (
              <>
                <Num>{ordinal(est.percentile)}</Num>
                <span className="text-muted"> · {est.poolConfidence}</span>
              </>
            ) : (
              <span className="insufficient">{PRODUCT_LANGUAGE.insufficientEvidence}</span>
            )}
          </span>
          <span className="text-rubric">
            <Num>{row.evaluationCount}</Num>
            <span className="text-muted"> rubric</span>
          </span>
        </div>
      </button>
    </li>
  );
}
