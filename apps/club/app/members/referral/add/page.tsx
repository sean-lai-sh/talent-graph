import { EmptyState } from "@/components/ui/EmptyState.tsx";

export const dynamic = "force-dynamic";

export default function AddReferralPlaceholder() {
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <EmptyState title="Under construction">
        Adding a referral to an existing profile is not available yet.
      </EmptyState>
    </main>
  );
}
