"use client";

import { useState } from "react";
import { DIMENSIONS } from "../../../../src/domain/constants.ts";
import type { Dimension } from "../../../../src/domain/types.ts";
import { dimensionLabel } from "../../../../src/inference/capabilityVector.ts";
import type { ReviewConfig, SetReviewConfigInput } from "../../lib/types.ts";
import { Button } from "../ui/Button.tsx";

/** Which dimensions this round requires evidence on. A checklist, never a weight. */
export function RoundSettings({
  config,
  busy,
  onSave,
}: {
  config: ReviewConfig;
  busy: boolean;
  onSave: (input: SetReviewConfigInput) => void;
}) {
  const [picked, setPicked] = useState<Dimension[]>(config.requiredDimensions);
  const toggle = (d: Dimension) =>
    setPicked((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (picked.length === 0) return;
        onSave({ requiredDimensions: DIMENSIONS.filter((d) => picked.includes(d)) });
      }}
    >
      <p className="text-sm font-medium">Required dimensions</p>
      <p className="mb-2 text-[11px] text-muted">
        Marks the case summary and drives the missing-evidence list. Not a weight; nothing is
        totalled.
      </p>
      <ul className="space-y-1">
        {DIMENSIONS.map((d) => (
          <li key={d}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-subtle">
              <input
                type="checkbox"
                className="accent-ink"
                checked={picked.includes(d)}
                onChange={() => toggle(d)}
              />
              {dimensionLabel(d)}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={busy || picked.length === 0}>
          Save
        </Button>
      </div>
    </form>
  );
}
