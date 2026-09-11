import { REVIEW_BUCKET_COPY, type ReviewBucket } from "../../../../src/analysis/reviewQueue.ts";
import { PRODUCT_LANGUAGE } from "../../../../src/domain/constants.ts";
import { relativeRankText } from "../../lib/format.ts";
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

/**
 * One score, how they sit among people we've seen, and what to watch.
 * The number is the Referral Signal; we do not merge channels.
 */
export function ChannelSummary({ person }: { person: PersonView }) {
  const measured = person.incomingCount >= 1 && person.v2Signal !== null;
  const ranks = person.dimensions.filter(
    (d) => d.state === "estimated" && d.percentile !== null && d.poolSize !== null,
  );
  const watch = (person.queue?.flags ?? []).filter((f) => WATCH.includes(f));
  const gaps = person.gaps.filter((g) => g.gap >= 25);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="sr-only">{PRODUCT_LANGUAGE.referralSignal}</h3>
        {measured ? (
          <p className="text-5xl font-semibold tracking-tight">
            <Num>{person.v2Signal}</Num>
          </p>
        ) : (
          <>
            <p className="insufficient text-2xl">{PRODUCT_LANGUAGE.insufficientEvidence}</p>
            <p className="mt-1 text-xs text-muted">Missing evidence is not a score of 0.</p>
          </>
        )}
        {person.networkHint ? (
          <p className="mt-2 text-sm text-secondary">{person.networkHint.text}</p>
        ) : null}
      </div>

      <div>
        <h3 className="sr-only">{PRODUCT_LANGUAGE.relativeCapability}</h3>
        {ranks.length > 0 ? (
          <ul className="space-y-0.5 text-sm">
            {ranks.map((d) => (
              <li key={d.dimension} className={d.required ? "text-ink" : "text-secondary"}>
                {relativeRankText(d.percentile, d.poolSize, d.label)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{PRODUCT_LANGUAGE.insufficientEvidence}</p>
        )}
      </div>

      {watch.length > 0 || gaps.length > 0 ? (
        <p className="text-sm text-secondary">
          {watch.map((f) => REVIEW_BUCKET_COPY[f].label).join(" · ")}
          {gaps.length > 0 ? (
            <>
              {watch.length > 0 ? " · " : ""}
              {PRODUCT_LANGUAGE.exploratory} {PRODUCT_LANGUAGE.underRecognitionGap}
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
