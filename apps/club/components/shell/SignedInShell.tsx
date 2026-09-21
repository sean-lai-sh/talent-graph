"use client";

import type { ReactNode } from "react";
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
  onSignOut,
  children,
}: {
  navLabel: string;
  items: readonly SignedInNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  title: string;
  onSignOut?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="signed-shell">
      <nav className="signed-nav" aria-label={navLabel}>
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
