import { EmptyState } from "../../components/ui/EmptyState.tsx";

/** Empty evaluations pane. The signed-in inbox stays in `FeedbackInbox`. */
export function DemoEvaluations() {
  return (
    <div className="forum">
      <EmptyState title="No feedback requests waiting.">
        When the council asks you about someone, the request shows up here.
      </EmptyState>
    </div>
  );
}
