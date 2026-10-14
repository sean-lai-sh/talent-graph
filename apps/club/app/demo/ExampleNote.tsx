import { EXAMPLE_DATA_LABEL, EXAMPLE_DATA_NOTE } from "../../lib/copy.ts";

/** Persistent example-data label for every public demo screen. */
export function ExampleNote() {
  return (
    <p className="example-note" role="note" title={EXAMPLE_DATA_NOTE}>
      {EXAMPLE_DATA_LABEL}
      <span className="example-note-detail">{EXAMPLE_DATA_NOTE}</span>
    </p>
  );
}
