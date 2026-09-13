import type { ReactNode } from "react";

export function EmptyState({
  title,
  children,
  className = "",
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-dashed border-line-strong px-4 py-6 text-center ${className}`}
    >
      <p className="text-sm font-medium text-ink">{title}</p>
      {children ? <div className="mt-1 text-xs text-muted">{children}</div> : null}
    </div>
  );
}
