"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "./Button.tsx";

/** Trigger + anchored panel. Scales in from its trigger; closes on Esc or outside click. */
export function Popover({
  label,
  children,
  align = "right",
  variant = "secondary",
  size = "sm",
  width = "w-80",
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
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

  return (
    <div ref={ref} className="relative">
      <Button
        variant={variant}
        size={size}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </Button>
      {open ? (
        <div
          id={id}
          role="dialog"
          style={{ ["--origin" as string]: align === "right" ? "top right" : "top left" }}
          className={`popover absolute top-full z-30 mt-1.5 rounded-lg border border-line bg-surface p-3 ${width} ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
