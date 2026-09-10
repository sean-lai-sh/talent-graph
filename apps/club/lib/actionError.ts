export function describeActionError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return "The last action failed. Reset to seed restores this example club.";
}
