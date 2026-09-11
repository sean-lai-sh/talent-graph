"use client";

import { PRODUCT_LANGUAGE } from "../../../../src/domain/constants.ts";
import type { PersonView } from "../../lib/types.ts";
import { isExploratory, readinessOf, referralSignalLabel } from "./readiness.ts";

export function CandidateQueue({
  title,
  people,
  selectedId,
  onSelect,
  showMath = false,
  empty,
}: {
  title: string;
  people: PersonView[];
  selectedId: string;
  onSelect: (id: string) => void;
  showMath?: boolean;
  empty: string;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-panel">
      <div className="border-b border-line px-3 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="mt-0.5 text-[10px] text-muted">
          {people.length} in this list · {PRODUCT_LANGUAGE.referralSignal} and{" "}
          {PRODUCT_LANGUAGE.relativeCapability} stay separate
        </p>
      </div>
      <div className="board-scroll min-h-0 flex-1 overflow-y-auto">
        {people.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted">{empty}</p>
        ) : (
          <ul>
            {people.map((person) => (
              <QueueRow
                key={person.id}
                person={person}
                selected={person.id === selectedId}
                showMath={showMath}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function QueueRow({
  person,
  selected,
  showMath,
  onSelect,
}: {
  person: PersonView;
  selected: boolean;
  showMath: boolean;
  onSelect: (id: string) => void;
}) {
  const readiness = readinessOf(person);
  const signal = referralSignalLabel(person);
  const measured = person.incomingCount >= 1 && person.v2Signal !== null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(person.id)}
        className={`flex w-full flex-col items-start gap-1.5 border-b border-line px-3 py-2.5 text-left hover:bg-paper ${
          selected ? "bg-paper" : ""
        }`}
      >
        <span className="flex w-full items-baseline justify-between gap-2">
          <span className="truncate font-medium">
            {person.name}
            {person.persona ? <span className="ml-1 text-[10px] text-signal">●</span> : null}
          </span>
          <span className={`shrink-0 font-mono text-xs ${measured ? "text-signal" : "text-muted"}`}>
            {signal}
          </span>
        </span>
        <span className="flex w-full flex-wrap items-center gap-1.5">
          <ReadinessTag tag={readiness.tag} />
          {isExploratory(person) ? (
            <span className="rounded-full bg-gap/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gap">
              {PRODUCT_LANGUAGE.exploratory}
            </span>
          ) : null}
          <DimensionDots person={person} />
        </span>
        {showMath ? <RowMath person={person} /> : null}
      </button>
    </li>
  );
}

function ReadinessTag({ tag }: { tag: string }) {
  return (
    <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
      {tag}
    </span>
  );
}

function DimensionDots({ person }: { person: PersonView }) {
  return (
    <span className="ml-auto flex items-center gap-1" title="Dimension estimates">
      {person.dimensions.map((d) => (
        <span
          key={d.dimension}
          title={`${d.label}: ${
            d.state === "estimated"
              ? PRODUCT_LANGUAGE.relativeCapability
              : PRODUCT_LANGUAGE.insufficientEvidence
          }`}
          className={`inline-block h-2 w-2 rounded-full ${
            d.state === "estimated" ? "bg-capability" : "border border-line bg-transparent"
          }`}
        />
      ))}
    </span>
  );
}

function RowMath({ person }: { person: PersonView }) {
  const compares = person.dimensions.reduce((n, d) => n + d.comparisonCount, 0);
  const topGap = person.gaps[0];
  return (
    <span className="w-full font-mono text-[10px] leading-relaxed text-muted">
      V0 {person.v0Signal ?? PRODUCT_LANGUAGE.insufficientEvidence}
      {" · "}
      V2 {person.v2Signal ?? PRODUCT_LANGUAGE.insufficientEvidence}
      {" · "}
      {person.incomingCount} incoming · {compares} cmp
      {topGap ? (
        <>
          {" · "}
          {PRODUCT_LANGUAGE.underRecognitionGap} {Math.round(topGap.gap)}
        </>
      ) : null}
    </span>
  );
}
