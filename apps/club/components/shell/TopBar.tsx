"use client";

import { useEffect, useId, useRef, useState } from "react";
import { OWNER_NAME } from "../../lib/engine.ts";
import type { AddPersonInput, ReviewConfig, SetReviewConfigInput } from "../../lib/types.ts";
import { AddPersonForm } from "../forms/AddPersonForm.tsx";
import { Avatar } from "../ui/Avatar.tsx";
import { Mark } from "../ui/Mark.tsx";
import { RoundSettings } from "./RoundSettings.tsx";

export function TopBar({
  config,
  dirty,
  busy,
  canAdd,
  canReset,
  counter,
  onPrev,
  onNext,
  onOpenList,
  onAddPerson,
  onReset,
  onConfig,
  onSignOut,
}: {
  config: ReviewConfig;
  dirty: boolean;
  busy: boolean;
  canAdd: boolean;
  canReset: boolean;
  counter: string;
  onPrev: () => void;
  onNext: () => void;
  onOpenList: () => void;
  onAddPerson: (input: AddPersonInput) => void;
  onReset: () => void;
  onConfig: (input: SetReviewConfigInput) => void;
  onSignOut?: () => void;
}) {
  return (
    <header className="app-toolbar">
      <button
        type="button"
        className="list-trigger press"
        aria-label="Open applicant list"
        onClick={onOpenList}
      >
        <span>
          <i />
          <i />
          <i />
        </span>
      </button>
      <span className="deskbrand">
        <Mark />
        Tech@NYU
      </span>
      <div className="flex-1" />
      <div className="stepper">
        <button type="button" className="press" aria-label="Previous applicant" onClick={onPrev}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M8 2.5 4.5 6 8 9.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button type="button" className="press" aria-label="Next applicant" onClick={onNext}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M4 2.5 7.5 6 4 9.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="counter">{counter}</span>
      </div>
      <AccountMenu
        config={config}
        dirty={dirty}
        busy={busy}
        canAdd={canAdd}
        canReset={canReset}
        onAddPerson={onAddPerson}
        onReset={onReset}
        onConfig={onConfig}
        onSignOut={onSignOut}
      />
    </header>
  );
}

function AccountMenu({
  config,
  dirty,
  busy,
  canAdd,
  canReset,
  onAddPerson,
  onReset,
  onConfig,
  onSignOut,
}: {
  config: ReviewConfig;
  dirty: boolean;
  busy: boolean;
  canAdd: boolean;
  canReset: boolean;
  onAddPerson: (input: AddPersonInput) => void;
  onReset: () => void;
  onConfig: (input: SetReviewConfigInput) => void;
  onSignOut?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"menu" | "add" | "settings">("menu");
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setPanel("menu");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((value) => !value);
          setPanel("menu");
        }}
        className="press rounded-full"
      >
        <Avatar name={OWNER_NAME} />
      </button>
      {open ? (
        <div
          id={id}
          role="menu"
          style={{ ["--origin" as string]: "top right" }}
          className={`popover absolute top-full right-0 z-30 mt-1.5 rounded-lg border border-line bg-surface ${
            panel === "menu" ? "w-56 p-1" : "w-80 p-3"
          }`}
        >
          {panel === "menu" ? (
            <>
              <div className="px-2.5 py-2">
                <p className="text-sm font-medium">{OWNER_NAME}</p>
                <p className="text-xs text-muted">Council</p>
              </div>
              <div className="my-1 h-px bg-line" />
              {canAdd ? (
                <button
                  type="button"
                  role="menuitem"
                  className="press flex w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-subtle"
                  onClick={() => setPanel("add")}
                >
                  Add a person
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="press flex w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-subtle"
                onClick={() => setPanel("settings")}
              >
                Round settings
              </button>
              {canReset ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  className={`press flex w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-subtle ${
                    dirty ? "text-ink" : "text-secondary"
                  }`}
                  onClick={() => {
                    onReset();
                    close();
                  }}
                >
                  Reset to seed
                </button>
              ) : null}
              {onSignOut ? (
                <>
                  <div className="my-1 h-px bg-line" />
                  <button
                    type="button"
                    role="menuitem"
                    className="press flex w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-subtle"
                    onClick={() => {
                      close();
                      onSignOut();
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : null}
            </>
          ) : panel === "add" ? (
            <AddPersonForm
              busy={busy}
              onSubmit={(input) => {
                onAddPerson(input);
                close();
              }}
            />
          ) : (
            <RoundSettings
              config={config}
              busy={busy}
              onSave={(input) => {
                onConfig(input);
                close();
              }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
