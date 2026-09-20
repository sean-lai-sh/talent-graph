import { REVIEW_BUCKET_COPY, type ReviewBucket } from "../../../../src/analysis/reviewQueue.ts";
import { PRODUCT_LANGUAGE } from "../../../../src/domain/constants.ts";
import { informativeComparisons } from "../../lib/comparisonRecord.ts";
import {
  cohortAverage,
  rankAmong,
  rankShort,
  signalBand,
  signalContext,
} from "../../lib/format.ts";
import type { PersonView } from "../../lib/types.ts";
import { Num } from "../ui/Num.tsx";

const WATCH: readonly ReviewBucket[] = [
  "under_recognized",
  "single_source",
  "referred_not_compared",
  "needs_more_compares",
  "no_referrals",
  "no_evidence",
];

const DIAL_R = 86;
const DIAL_C = 2 * Math.PI * DIAL_R;

function signalsOf(people: PersonView[]): Array<number | null> {
  return people.map((p) => p.v2Signal);
}

function ScoreDial({ signal, average }: { signal: number | null; average: number | null }) {
  const measured = signal !== null;
  const fill = measured ? DIAL_C * (1 - signal / 100) : DIAL_C;
  const tick = average === null ? null : (average / 100) * 2 * Math.PI;
  return (
    <section className="card card-score">
      <h3 className="sr-only">{PRODUCT_LANGUAGE.referralSignal}</h3>
      <div className="dial">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle className="groove" cx="100" cy="100" r={DIAL_R} />
          <circle className="track" cx="100" cy="100" r={DIAL_R} />
          <circle
            className="fill"
            cx="100"
            cy="100"
            r={DIAL_R}
            strokeDasharray={DIAL_C}
            strokeDashoffset={fill}
          />
          {tick !== null ? (
            <line
              className="avgtick"
              x1={(100 + 94 * Math.cos(tick)).toFixed(1)}
              y1={(100 + 94 * Math.sin(tick)).toFixed(1)}
              x2={(100 + 99 * Math.cos(tick)).toFixed(1)}
              y2={(100 + 99 * Math.sin(tick)).toFixed(1)}
            />
          ) : null}
        </svg>
        {measured ? (
          <span className="dial-num">
            <Num>{signal}</Num>
          </span>
        ) : (
          <span className="insufficient text-sm">—</span>
        )}
      </div>
      <div className="verdict mt-6 text-center text-[1.0625rem] font-medium tracking-tight">
        {measured ? signalBand(signal) : PRODUCT_LANGUAGE.insufficientEvidence}
      </div>
      <div className="context mt-2 text-center text-[0.8125rem] text-faint">
        {signalContext(signal, average)}
      </div>
    </section>
  );
}

function Breakdown({ person, onCompare }: { person: PersonView; onCompare: () => void }) {
  const ranks = person.dimensions.filter(
    (d) => d.state === "estimated" && d.percentile !== null && d.poolSize !== null,
  );
  const watch = (person.queue?.flags ?? []).filter((f) => WATCH.includes(f));
  const gaps = person.gaps.filter((g) => g.gap >= 25);
  const hasCompares = informativeComparisons(person.comparisonHistory).length > 0;
  return (
    <section className="card">
      <h2 className="card-h">
        <span className="sr-only">{PRODUCT_LANGUAGE.relativeCapability}</span>
        Breakdown
        {hasCompares ? (
          <span className="card-actions ml-auto">
            <button type="button" onClick={onCompare} className="press">
              View comparisons ›
            </button>
          </span>
        ) : null}
      </h2>
      {ranks.length > 0 ? (
        <div>
          {ranks.map((d) => {
            const of = d.poolSize as number;
            const rank = rankAmong(d.percentile as number, of);
            const width = ((of - rank + 1) / of) * 100;
            return (
              <div
                key={d.dimension}
                className="metric grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 pt-3 first:pt-0"
              >
                <span className="text-[0.8125rem] text-secondary">{d.label}</span>
                <span className="num text-right text-[0.8125rem] text-faint">
                  <Num>{rankShort(d.percentile as number, of)}</Num>
                </span>
                <span className="metric-bar col-span-full mt-2">
                  <i style={{ width: `${width}%` }} />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="empty-note">{PRODUCT_LANGUAGE.insufficientEvidence}</p>
      )}
      {watch.length > 0 || gaps.length > 0 ? (
        <p className="mt-4 text-[0.8125rem] text-secondary">
          {watch.map((f) => REVIEW_BUCKET_COPY[f].label).join(" · ")}
          {gaps.length > 0 ? (
            <>
              {watch.length > 0 ? " · " : ""}
              {PRODUCT_LANGUAGE.exploratory} {PRODUCT_LANGUAGE.underRecognitionGap}
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Dial is the Referral Signal. Bars are capability ranks. We do not merge them.
 */
export function ChannelSummary({
  person,
  people,
  onCompare,
}: {
  person: PersonView;
  people: PersonView[];
  onCompare: () => void;
}) {
  const average = cohortAverage(signalsOf(people));
  return (
    <div className="board-score">
      <ScoreDial signal={person.v2Signal} average={average} />
      <Breakdown person={person} onCompare={onCompare} />
    </div>
  );
}
