"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Button } from "../ui/Button.tsx";

export type SignedInNavItem = {
  id: string;
  label: string;
  count?: number;
};

/**
 * Shared signed-in chrome: left nav + a top bar over the main pane.
 * Identity lives in the account control, never a banner over the page.
 */
export function SignedInShell({
  navLabel,
  items,
  activeId,
  onSelect,
  title,
  notice,
  keyboardNav = false,
  onSignOut,
  children,
}: {
  navLabel: string;
  items: readonly SignedInNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  title: string;
  /** Public demo label. Omitted, the bar matches the signed-in shell. */
  notice?: ReactNode;
  /** Arrow keys between nav buttons. Off unless a caller asks. */
  keyboardNav?: boolean;
  onSignOut?: () => void;
  children: ReactNode;
}) {
  const onNavKey = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const buttons = [...event.currentTarget.querySelectorAll("button")];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next =
      event.key === "ArrowDown"
        ? Math.min(buttons.length - 1, index + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, index - 1)
          : event.key === "Home"
            ? 0
            : buttons.length - 1;
    buttons[next]?.focus();
  };

  return (
    <div className="signed-shell">
      <nav
        className="signed-nav"
        aria-label={navLabel}
        onKeyDown={keyboardNav ? onNavKey : undefined}
      >
        {items.map((item) => {
          const current = item.id === activeId;
          const count =
            item.count === undefined ? null : (
              <span className="signed-nav-count">{item.count}</span>
            );
          return (
            <button
              key={item.id}
              type="button"
              className="signed-nav-btn press"
              aria-current={current ? "page" : undefined}
              onClick={() => onSelect(item.id)}
            >
              <span>{item.label}</span>
              {count}
            </button>
          );
        })}
      </nav>
      <div className="signed-stage">
        <header className="signed-bar">
          <h1 className="signed-bar-title">{title}</h1>
          {notice}
          <div className="flex-1" />
          {onSignOut ? (
            <Button type="button" onClick={onSignOut}>
              Sign out
            </Button>
          ) : null}
        </header>
        <div className="signed-main">{children}</div>
      </div>
    </div>
  );
}
