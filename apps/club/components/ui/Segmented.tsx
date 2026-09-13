/** A 1–5 (or any small) choice as buttons, with a caption for the chosen value. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  captions,
  disabled,
  allowNone,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (v: T | null) => void;
  captions?: Partial<Record<T, string>>;
  disabled?: boolean;
  allowNone?: string;
}) {
  return (
    <div>
      <div className="inline-flex overflow-hidden rounded-md border border-line">
        {allowNone ? (
          <button
            type="button"
            disabled={disabled}
            aria-pressed={value === null}
            onClick={() => onChange(null)}
            className={`press h-7 border-r border-line px-2 text-xs ${
              value === null ? "bg-ink text-canvas" : "bg-surface text-secondary hover:bg-subtle"
            }`}
          >
            {allowNone}
          </button>
        ) : null}
        {options.map((o, i) => (
          <button
            key={String(o)}
            type="button"
            disabled={disabled}
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={`press num h-7 min-w-8 px-2 text-xs ${i < options.length - 1 ? "border-r border-line" : ""} ${
              value === o ? "bg-ink text-canvas" : "bg-surface text-secondary hover:bg-subtle"
            }`}
          >
            {String(o)}
          </button>
        ))}
      </div>
      {captions && value !== null && captions[value] ? (
        <p className="mt-1 text-[11px] text-muted">{captions[value]}</p>
      ) : null}
    </div>
  );
}
