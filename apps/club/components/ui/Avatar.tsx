/** Circular account mark. Initials when there is no photo. */
export function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(180deg,#2A2A30,#1F1F25)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.06)",
        color: "var(--t3)",
      }}
      aria-hidden
    >
      <span className="text-[11px] font-semibold leading-none">{initials || "?"}</span>
    </span>
  );
}
