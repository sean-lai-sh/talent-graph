"use client";

import { PRODUCT_LANGUAGE } from "../../../../src/domain/constants.ts";
import type { AddPersonInput, ClubView, SetReviewConfigInput } from "../../lib/types.ts";
import { AddPersonForm } from "../forms/AddPersonForm.tsx";
import { Button } from "../ui/Button.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { Num } from "../ui/Num.tsx";
import { Popover } from "../ui/Popover.tsx";
import { RoundSettings } from "./RoundSettings.tsx";

export function TopBar({
  view,
  variant,
  dirty,
  busy,
  canAdd,
  canReset,
  onAddPerson,
  onReset,
  onConfig,
  onPresent,
}: {
  view: ClubView;
  variant: "example" | "club";
  dirty: boolean;
  busy: boolean;
  canAdd: boolean;
  canReset: boolean;
  onAddPerson: (input: AddPersonInput) => void;
  onReset: () => void;
  onConfig: (input: SetReviewConfigInput) => void;
  onPresent: () => void;
}) {
  const c = view.counts;
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur">
      <div className="flex h-12 items-center gap-4 px-4">
        <div className="hidden min-w-0 items-baseline gap-2 sm:flex">
          <span className="caps text-muted">Talent Graph</span>
          <h1 className="truncate text-sm font-semibold">
            {variant === "club" ? "Council review · your club" : "Council review · example seed"}
          </h1>
        </div>
        <dl className="hidden items-center gap-4 text-xs text-secondary lg:flex">
          <Kpi label="under consideration" value={c.underConsideration} />
          <Kpi label="needs data" value={c.needsData} />
          <Kpi label="admitted" value={c.admitted} />
          <Kpi label="denied" value={c.denied} />
          <Kpi label="feedback pending" value={c.pendingFeedback} />
          <Kpi
            label="overdue"
            value={c.overdueFeedback}
            tone={c.overdueFeedback > 0 ? "danger" : undefined}
          />
        </dl>
        <div className="ml-auto flex items-center gap-2">
          {variant === "example" && dirty ? (
            <span className="caps hidden text-warn sm:inline">Local edits · not the seed</span>
          ) : null}
          <Popover label="Round settings" width="w-72">
            {(close) => (
              <RoundSettings
                config={view.config}
                busy={busy}
                onSave={(input) => {
                  onConfig(input);
                  close();
                }}
              />
            )}
          </Popover>
          {canAdd ? (
            <Popover label="Add a person" width="w-80">
              {(close) => (
                <AddPersonForm
                  busy={busy}
                  onSubmit={(input) => {
                    onAddPerson(input);
                    close();
                  }}
                />
              )}
            </Popover>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={onPresent}
            title="Present mode for screen share (Esc to exit)"
          >
            Present
          </Button>
          {canReset ? (
            <Button
              size="sm"
              variant={dirty ? "primary" : "ghost"}
              onClick={onReset}
              disabled={busy}
            >
              Reset to seed
            </Button>
          ) : null}
        </div>
      </div>
      <p className="hidden border-t border-line px-4 py-1 text-[11px] text-muted xl:block">
        {PRODUCT_LANGUAGE.referralSignal} is how loud the network is.{" "}
        {PRODUCT_LANGUAGE.relativeCapability} is how they look on pairwise compares.{" "}
        {PRODUCT_LANGUAGE.structuredEvidence} is what evaluators wrote on the rubric. Three
        channels, never one number. Missing evidence is not low ability, and not a score of 0.{" "}
        <Kbd>J</Kbd> <Kbd>K</Kbd> move between cases.
      </p>
    </header>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="text-muted">{label}</dt>
      <dd className={tone === "danger" ? "text-danger" : "text-ink"}>
        <Num>{value}</Num>
      </dd>
    </div>
  );
}
