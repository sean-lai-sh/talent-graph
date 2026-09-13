export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="num inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-raised px-1 text-[11px] text-secondary">
      {children}
    </kbd>
  );
}
