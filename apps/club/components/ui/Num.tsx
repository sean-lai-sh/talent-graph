import type { ReactNode } from "react";

/** Tabular numerals so columns line up. */
export function Num({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`num ${className}`}>{children}</span>;
}
