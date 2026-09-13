import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-canvas hover:opacity-90 border-transparent",
  secondary: "bg-surface text-ink border-line hover:bg-subtle",
  ghost: "bg-transparent text-secondary border-transparent hover:bg-subtle hover:text-ink",
  danger: "bg-surface text-danger border-line hover:bg-danger-tint",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {children}
    </button>
  );
}
