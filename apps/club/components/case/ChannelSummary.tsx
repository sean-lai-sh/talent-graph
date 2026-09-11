import { PRODUCT_LANGUAGE } from "../../../../src/domain/constants.ts";
import { CAPABILITY_EXPLANATION } from "../../../../src/inference/capabilityVector.ts";
import { REFERRAL_SIGNAL_EXPLANATION } from "../../../../src/scoring/referralSignal.ts";
import { ordinal, plural } from "../../lib/format.ts";
import type { PersonView } from "../../lib/types.ts";
import { Num } from "../ui/Num.tsx";

/**
 * The case summary: three channels, one card each, never one number.
 * Referral Signal (network) ┃ Relative Capability Estimate (compares) ┃ Structured Evidence (rubric).
 */
export function ChannelSummary({ person }: { person: PersonView }) {
  const measured = person.incomingCount >= 1 && person.v2Signal !== null;
  const delta =
    measured && person.v0Signal !== null && person.v2Signal !== null
      ? person.v2Signal - person.v0Signal
      : 0;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <article className="rounded-lg border border-line p-3">
        <h3 className="caps text-referral">{PRODUCT_LANGUAGE.referralSignal}</h3>
        {measured ? (
          <>
            <p className="mt-1 text-3xl font-semibold text-ink">
              <Num>{person.v2Signal}</Num>
              <span className="text-base text-faint">/100</span>
            </p>
            <p className="mt-1 text-xs text-secondary">
              {plural(person.incomingCount, "incoming referral")} · {person.firsthandCount}{" "}
              firsthand · strongest{" "}
              <Num>{person.strongest === null ? "—" : person.strongest.toFixed(2)}</Num>
            </p>
            {delta !== 0 && person.v0Signal !== null ? (
              <p className="mt-1 text-[11px] text-muted">
                Before referrer calibration: <Num>{person.v0Signal}</Num>. Calibration{" "}
                {delta > 0 ? "raised" : "lowered"} it by <Num>{Math.abs(delta)}</Num>.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="insufficient mt-1 text-lg">{PRODUCT_LANGUAGE.insufficientEvidence}</p>
            <p className="mt-1 text-xs text-muted">
              No incoming referrals. Missing evidence is not low ability, and not a score of 0.
            </p>
          </>
        )}
        <p className="mt-2 text-[11px] leading-snug text-muted">{REFERRAL_SIGNAL_EXPLANATION}</p>
      </article>

      <article className="rounded-lg border border-line p-3">
        <h3 className="caps text-capability">{PRODUCT_LANGUAGE.relativeCapability}</h3>
        <ul className="mt-1 divide-y divide-line">
          {person.dimensions.map((d) => (
            <li
              key={d.dimension}
              className="flex items-baseline justify-between gap-2 py-1 text-sm"
            >
              <span className={d.required ? "font-medium" : "text-secondary"}>
                {d.label}
                {d.required ? (
                  <span className="ml-1 text-faint" title="Required this round">
                    •
                  </span>
                ) : null}
              </span>
              {d.state === "estimated" && d.percentile !== null ? (
                <span className="text-right text-xs">
                  <Num className="text-ink">{ordinal(d.percentile)}</Num>
                  <span className="text-muted">
                    {" "}
                    · {d.comparisonCount} cmp · pool {d.poolSize} · {d.poolConfidence}
                  </span>
                </span>
              ) : (
                <span className="insufficient text-right text-xs" title={d.reason ?? undefined}>
                  {PRODUCT_LANGUAGE.insufficientEvidence}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-snug text-muted">{CAPABILITY_EXPLANATION}</p>
      </article>

      <article className="rounded-lg border border-line p-3">
        <h3 className="caps text-rubric">{PRODUCT_LANGUAGE.structuredEvidence}</h3>
        <ul className="mt-1 divide-y divide-line">
          {person.rubric.map((r) => (
            <li
              key={r.dimension}
              className="flex items-baseline justify-between gap-2 py-1 text-sm"
            >
              <span className={r.required ? "font-medium" : "text-secondary"}>
                {r.label}
                {r.required ? (
                  <span className="ml-1 text-faint" title="Required this round">
                    •
                  </span>
                ) : null}
              </span>
              {r.mean !== null ? (
                <span className="text-right text-xs">
                  <Num className="text-ink">{r.mean.toFixed(1)}</Num>
                  <span className="text-muted">
                    /4 · {plural(r.evaluators, "evaluator")}
                    {r.notObserved > 0 ? ` · ${r.notObserved} N/O` : ""}
                  </span>
                </span>
              ) : r.notObserved > 0 ? (
                <span className="text-right text-xs text-muted">
                  {PRODUCT_LANGUAGE.notObserved} · {plural(r.notObserved, "evaluator")}
                </span>
              ) : (
                <span className="text-right text-xs text-faint">no evaluation</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-snug text-muted">
          Rubric observations on the 0–4 anchors. Summarised here; they feed no score.
        </p>
      </article>
    </div>
  );
}
