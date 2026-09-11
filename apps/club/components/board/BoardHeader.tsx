"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PRODUCT_LANGUAGE } from "../../../../src/domain/constants.ts";
import type { ClubView } from "../../lib/types.ts";

export function BoardHeader({
  variant,
  surface,
  view,
  dirty,
  pendingAdd,
  newPersonName,
  onNewPersonName,
  onAddPerson,
  onReset,
  extra,
}: {
  variant: "example" | "club";
  surface: "review" | "lab";
  view: ClubView;
  dirty: boolean;
  pendingAdd?: boolean;
  newPersonName?: string;
  onNewPersonName?: (value: string) => void;
  onAddPerson?: () => void;
  onReset?: () => void;
  extra?: ReactNode;
}) {
  const boardHref = variant === "club" ? "/club" : "/example";
  const labHref = variant === "club" ? "/club/lab" : "/example/lab";

  return (
    <header className="board-header sticky top-0 z-10 flex flex-wrap items-end justify-between gap-3 border-b border-line bg-paper px-4 py-3 sm:px-5 sm:py-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
          {variant === "club" ? "Talent Graph · your club" : "Talent Graph · example admin"}
        </p>
        <h1 className="font-serif text-xl tracking-tight sm:text-2xl">
          {surface === "lab" ? "Lab" : "Who should this club look at?"}
        </h1>
        <p className="mt-1 hidden max-w-2xl text-sm text-muted md:block">
          {surface === "lab" ? (
            <>
              Compare, judge time, and the referral network live here.{" "}
              {PRODUCT_LANGUAGE.referralSignal} and {PRODUCT_LANGUAGE.relativeCapability} stay on
              the review board and are never merged.
            </>
          ) : variant === "club" ? (
            <>
              Members, referrals, and status persist in Convex. Views are computed by{" "}
              <code className="font-mono text-[12px]">src/</code> — not copied here. The public
              example stays open at / and /example with no sign-in.
            </>
          ) : (
            <>
              You are the admin of this public example club. {PRODUCT_LANGUAGE.referralSignal} is
              how loud the network is. {PRODUCT_LANGUAGE.relativeCapability} is how they look on
              pairwise compares. They are never merged. Reset to seed restores this example. No
              sign-in.
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <nav className="flex items-center gap-2">
          <Link
            href={boardHref}
            className={`rounded-full px-3 py-1 ${
              surface === "review" ? "bg-ink text-paper" : "border border-line hover:bg-paper"
            }`}
          >
            Board
          </Link>
          <Link
            href={labHref}
            className={`rounded-full px-3 py-1 ${
              surface === "lab" ? "bg-ink text-paper" : "border border-line hover:bg-paper"
            }`}
          >
            Lab
          </Link>
        </nav>
        <span className="hidden lg:inline">
          {view.counts.candidates} candidates · {view.counts.members} members ·{" "}
          {view.counts.archived} archived · {view.counts.referrals} referrals ·{" "}
          {view.counts.comparisons} compares
        </span>
        {variant === "example" && dirty ? (
          <span className="text-warn">Local edits · not the seed</span>
        ) : null}
        {extra}
        {onAddPerson && onNewPersonName ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onAddPerson();
            }}
          >
            <input
              className="rounded border border-line bg-paper px-2 py-1 text-ink"
              name="personName"
              placeholder="Add a person"
              value={newPersonName}
              onChange={(event) => onNewPersonName(event.target.value)}
            />
            <button
              type="submit"
              disabled={pendingAdd}
              className="rounded-full bg-ink px-3 py-1 text-paper hover:opacity-90 disabled:opacity-40"
            >
              Add
            </button>
          </form>
        ) : null}
        {onReset ? (
          <button
            type="button"
            className={
              dirty
                ? "rounded-full bg-ink px-3 py-1 text-paper hover:opacity-90"
                : "rounded-full border border-ink px-3 py-1 text-ink hover:bg-ink hover:text-paper"
            }
            onClick={onReset}
          >
            Reset to seed
          </button>
        ) : null}
      </div>
    </header>
  );
}

export function BoardError({
  error,
  onDismiss,
  onReset,
}: {
  error: string;
  onDismiss: () => void;
  onReset?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-warn sm:px-5"
    >
      <div>
        <p className="font-medium">Action did not apply</p>
        <p>{error}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-full border border-warn px-3 py-1 text-xs"
          onClick={onDismiss}
        >
          Dismiss
        </button>
        {onReset ? (
          <button
            type="button"
            className="rounded-full bg-ink px-3 py-1 text-xs text-paper"
            onClick={onReset}
          >
            Reset to seed
          </button>
        ) : null}
      </div>
    </div>
  );
}
