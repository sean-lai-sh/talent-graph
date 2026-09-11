import { Button } from "../ui/Button.tsx";

export function ErrorBanner({
  error,
  onDismiss,
  onReset,
}: {
  error: string;
  onDismiss: () => void;
  onReset?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-warn-tint bg-warn-tint px-4 py-2 text-sm text-warn"
    >
      <p>
        <span className="font-medium">Action did not apply.</span> {error}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
        {onReset ? (
          <Button size="sm" variant="secondary" onClick={onReset}>
            Reset to seed
          </Button>
        ) : null}
      </div>
    </div>
  );
}
