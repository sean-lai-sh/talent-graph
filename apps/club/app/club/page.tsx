import Link from "next/link";

/**
 * Real-organization door. Not installed in this slice:
 * no Clerk, no persistence, no login wall on the public example.
 */
export default function RealClubStub() {
  return (
    <main className="min-h-screen bg-paper px-6 py-16 text-ink">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Talent Graph · your club</p>
      <h1 className="mt-2 font-serif text-3xl tracking-tight">Not connected yet</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        This door is for a real organization later. The public example admin is open at{" "}
        <Link className="underline decoration-line underline-offset-2 hover:text-ink" href="/">
          /
        </Link>{" "}
        and{" "}
        <Link
          className="underline decoration-line underline-offset-2 hover:text-ink"
          href="/example"
        >
          /example
        </Link>
        . Open, no sign-in.
      </p>
    </main>
  );
}
