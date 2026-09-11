"use client";

import { useEffect, useRef, useState } from "react";
import {
  EVIDENCE_TYPES,
  PRODUCT_LANGUAGE,
  REFERRAL_EVIDENCE_PROMPT,
  REFERRAL_PRIMARY_PROMPT,
  SCALE_LABELS,
} from "../../../../src/domain/constants.ts";
import type { EvidenceType, PersonStatus, Scale5 } from "../../../../src/domain/types.ts";
import type { ClubSnapshot, PersonView } from "../../lib/types.ts";
import { ordinal, Scale, StatusChip } from "./primitives.tsx";
import { type IncomingReferralRow, referrerSummary } from "./referralOrigin.ts";

export type InternalsMode = "details" | "hidden" | "expanded";

export function DecisionCard({
  person,
  busy,
  referrers,
  snapshots,
  internalsMode,
  referralOpen,
  onReferralOpenChange,
  incoming,
  referrersOpen,
  onOpenReferrers,
  onStatus,
  onMeddle,
  onRefer,
}: {
  person: PersonView;
  busy: boolean;
  referrers: PersonView[];
  snapshots: ClubSnapshot[];
  internalsMode: InternalsMode;
  referralOpen?: boolean;
  onReferralOpenChange?: (open: boolean) => void;
  incoming?: IncomingReferralRow[];
  referrersOpen?: boolean;
  onOpenReferrers?: () => void;
  onStatus: (status: PersonStatus) => void;
  onMeddle: (
    referralId: string,
    patch: { conviction: Scale5; confidence: Scale5; relationshipDepth: Scale5 },
  ) => void;
  onRefer: (input: {
    referrerId: string;
    candidateId: string;
    conviction: Scale5;
    confidence: Scale5;
    relationshipDepth: Scale5;
    evidenceType: EvidenceType;
    evidenceText: string;
  }) => void;
}) {
  const measured = person.incomingCount >= 1 && person.v2Signal !== null;
  const context =
    person.note ?? [person.affiliation || "Unaffiliated", person.bio].filter(Boolean).join(" · ");

  const internals = (
    <ComputedInternals
      person={person}
      busy={busy}
      measured={measured}
      referrers={referrers}
      snapshots={snapshots}
      onMeddle={onMeddle}
      onRefer={onRefer}
    />
  );

  const showReferralOnly = internalsMode === "hidden" && referralOpen;

  return (
    <div className={busy ? "opacity-70" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-serif text-xl">{person.name}</h2>
          <p className="text-xs text-muted">{context}</p>
        </div>
        <StatusChip status={person.status} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {person.status !== "member" ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-full bg-capability px-3 py-1 text-xs text-white disabled:opacity-40"
            onClick={() => onStatus("member")}
          >
            Accept as member
          </button>
        ) : null}
        {person.status !== "archived" ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-full border border-line px-3 py-1 text-xs disabled:opacity-40"
            onClick={() => onStatus("archived")}
          >
            Archive
          </button>
        ) : null}
        {person.status !== "candidate" ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-full border border-line px-3 py-1 text-xs disabled:opacity-40"
            onClick={() => onStatus("candidate")}
          >
            Back to candidate
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-y border-line py-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">
            {PRODUCT_LANGUAGE.referralSignal}
          </p>
          {measured ? (
            <p className="font-mono text-3xl text-signal">{person.v2Signal}</p>
          ) : (
            <p className="text-lg text-muted">{PRODUCT_LANGUAGE.insufficientEvidence}</p>
          )}
          {incoming ? (
            <div className="mt-1">
              <p className="text-[11px] text-muted">
                {incoming.length === 0
                  ? "No incoming referrals"
                  : `Referred by ${referrerSummary(incoming)}`}
              </p>
              {onOpenReferrers ? (
                <button
                  type="button"
                  className="mt-1 text-[11px] underline decoration-line underline-offset-2 hover:text-ink"
                  onClick={onOpenReferrers}
                >
                  {referrersOpen ? "Who referred · showing" : "Who referred"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">
            {PRODUCT_LANGUAGE.relativeCapability}
          </p>
          <p className="text-sm text-capability">Seven dimensions. No overall number.</p>
        </div>
      </div>

      <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Dimensions</h3>
      <ul className="mt-1 space-y-1">
        {person.dimensions.map((d) => (
          <li key={d.dimension} className="flex items-baseline justify-between gap-2 text-sm">
            <span>{d.label}</span>
            {d.state === "estimated" ? (
              <span className="font-mono text-xs text-capability">
                {ordinal(d.percentile ?? 0)} · {d.comparisonCount} cmp · pool {d.poolSize}
              </span>
            ) : (
              <span className="text-right text-[11px] text-muted">
                {PRODUCT_LANGUAGE.insufficientEvidence}
              </span>
            )}
          </li>
        ))}
      </ul>

      {person.gaps.some((g) => g.gap >= 25) ? (
        <div className="mt-3 text-xs text-gap">
          <p className="uppercase tracking-wide">{PRODUCT_LANGUAGE.exploratory}</p>
          {person.gaps
            .filter((g) => g.gap >= 25)
            .map((g) => (
              <p key={g.dimension}>
                {g.dimensionLabel} · cap {ordinal(g.capabilityPercentile)} · V2{" "}
                {ordinal(g.referralPercentile)} · +{Math.round(g.gap)}
              </p>
            ))}
        </div>
      ) : null}

      {internalsMode === "details" ? (
        <details className="mt-5 rounded border border-line bg-paper/60 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">How this was computed</summary>
          <div className="mt-3">{internals}</div>
        </details>
      ) : null}

      {internalsMode === "expanded" ? <div className="mt-5">{internals}</div> : null}

      {showReferralOnly ? (
        <div className="mt-5">
          <ReferralForm
            person={person}
            busy={busy}
            referrers={referrers}
            autoFocus
            onRefer={onRefer}
            onDone={() => onReferralOpenChange?.(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function ComputedInternals({
  person,
  busy,
  measured,
  referrers,
  snapshots,
  onMeddle,
  onRefer,
}: {
  person: PersonView;
  busy: boolean;
  measured: boolean;
  referrers: PersonView[];
  snapshots: ClubSnapshot[];
  onMeddle: DecisionCardHandlers["onMeddle"];
  onRefer: DecisionCardHandlers["onRefer"];
}) {
  const delta =
    measured && person.v0Signal !== null && person.v2Signal !== null
      ? person.v2Signal - person.v0Signal
      : 0;

  return (
    <>
      <div className="text-[11px] text-muted">
        {measured ? (
          <p>
            V0 {person.v0Signal}
            {delta !== 0
              ? ` → V2 ${person.v2Signal} (${delta > 0 ? "+" : ""}${delta})`
              : " · judges have not moved this number"}
            {" · "}
            {person.incomingCount} incoming · {person.firsthandCount} firsthand
          </p>
        ) : (
          <p>No incoming referrals. Missing evidence is not low ability.</p>
        )}
      </div>

      <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-muted">
        Recent decisions
      </h3>
      {snapshots.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted">
          Accept and archive record a local snapshot. None yet.
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {snapshots.slice(0, 8).map((s) => (
            <li key={s.id} className="text-[11px] text-muted">
              <span className={s.personId === person.id ? "text-ink" : ""}>
                {s.personName} · {s.decision} ·{" "}
                {s.values.referralSignal === null
                  ? PRODUCT_LANGUAGE.insufficientEvidence
                  : `V2 ${s.values.referralSignal}`}{" "}
                · {s.values.incomingCount} incoming · {s.createdAt.slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-muted">
        Contributing referrals — meddle
      </h3>
      <p className="text-[11px] text-muted">
        Sliders rewrite the original prediction in place (updatedAt stays put) so V2 still scores
        it.
      </p>
      <ul className="mt-2 space-y-3">
        {person.contributing.map((c) => (
          <li key={c.referralId} className="rounded border border-line p-2">
            <p className="text-sm">
              {c.referrerName}{" "}
              <span className="font-mono text-xs text-muted">
                p̂·R {c.strength.toFixed(2)} · p̂ {c.reliability.toFixed(2)} · {c.evidenceType}
              </span>
            </p>
            <Scale
              label="Conviction"
              value={c.conviction}
              captions={SCALE_LABELS.conviction}
              disabled={busy}
              onCommit={(conviction) =>
                onMeddle(c.referralId, {
                  conviction,
                  confidence: c.confidence,
                  relationshipDepth: c.relationshipDepth,
                })
              }
            />
            <Scale
              label="Confidence"
              value={c.confidence}
              captions={SCALE_LABELS.confidence}
              disabled={busy}
              onCommit={(confidence) =>
                onMeddle(c.referralId, {
                  conviction: c.conviction,
                  confidence,
                  relationshipDepth: c.relationshipDepth,
                })
              }
            />
            <Scale
              label="Relationship"
              value={c.relationshipDepth}
              captions={SCALE_LABELS.relationshipDepth}
              disabled={busy}
              onCommit={(relationshipDepth) =>
                onMeddle(c.referralId, {
                  conviction: c.conviction,
                  confidence: c.confidence,
                  relationshipDepth,
                })
              }
            />
          </li>
        ))}
        {person.contributing.length === 0 ? (
          <li className="text-sm text-muted">No incoming referrals yet.</li>
        ) : null}
      </ul>

      <ReferralForm person={person} busy={busy} referrers={referrers} onRefer={onRefer} />
    </>
  );
}

type DecisionCardHandlers = {
  onMeddle: (
    referralId: string,
    patch: { conviction: Scale5; confidence: Scale5; relationshipDepth: Scale5 },
  ) => void;
  onRefer: (input: {
    referrerId: string;
    candidateId: string;
    conviction: Scale5;
    confidence: Scale5;
    relationshipDepth: Scale5;
    evidenceType: EvidenceType;
    evidenceText: string;
  }) => void;
};

function ReferralForm({
  person,
  busy,
  referrers,
  onRefer,
  autoFocus,
  onDone,
}: {
  person: PersonView;
  busy: boolean;
  referrers: PersonView[];
  onRefer: DecisionCardHandlers["onRefer"];
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const [referrerId, setReferrerId] = useState(referrers[0]?.id ?? "");
  const [conviction, setConviction] = useState<Scale5>(4);
  const [confidence, setConfidence] = useState<Scale5>(4);
  const [depth, setDepth] = useState<Scale5>(3);
  const [evidenceType, setEvidenceType] = useState<EvidenceType>("firsthand_work");
  const [evidenceText, setEvidenceText] = useState("");
  const evidenceRef = useRef<HTMLTextAreaElement>(null);

  const resolvedReferrerId = referrers.some((r) => r.id === referrerId)
    ? referrerId
    : (referrers[0]?.id ?? "");

  useEffect(() => {
    if (autoFocus) evidenceRef.current?.focus();
  }, [autoFocus]);

  return (
    <form
      id="write-referral"
      className="mt-5 space-y-2 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || !resolvedReferrerId || evidenceText.trim() === "") return;
        onRefer({
          referrerId: resolvedReferrerId,
          candidateId: person.id,
          conviction,
          confidence,
          relationshipDepth: depth,
          evidenceType,
          evidenceText,
        });
        setEvidenceText("");
        onDone?.();
      }}
    >
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
        Write a referral · {PRODUCT_LANGUAGE.structuredEvidence}
      </h3>
      <p className="text-sm">{REFERRAL_PRIMARY_PROMPT}</p>
      <select
        className="w-full border border-line bg-paper px-2 py-1 text-sm"
        value={resolvedReferrerId}
        disabled={busy}
        onChange={(e) => setReferrerId(e.target.value)}
      >
        {referrers.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <textarea
        required
        rows={3}
        disabled={busy}
        ref={evidenceRef}
        className="w-full border border-line bg-paper px-2 py-2 text-sm"
        placeholder={REFERRAL_EVIDENCE_PROMPT}
        value={evidenceText}
        onChange={(e) => setEvidenceText(e.target.value)}
      />
      <select
        className="w-full border border-line bg-paper px-2 py-1 text-sm"
        value={evidenceType}
        disabled={busy}
        onChange={(e) => setEvidenceType(e.target.value as EvidenceType)}
      >
        {EVIDENCE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <Scale
        label="Conviction"
        value={conviction}
        captions={SCALE_LABELS.conviction}
        disabled={busy}
        onChange={setConviction}
      />
      <Scale
        label="Confidence"
        value={confidence}
        captions={SCALE_LABELS.confidence}
        disabled={busy}
        onChange={setConfidence}
      />
      <Scale
        label="Relationship"
        value={depth}
        captions={SCALE_LABELS.relationshipDepth}
        disabled={busy}
        onChange={setDepth}
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper disabled:opacity-40"
      >
        Add referral
      </button>
    </form>
  );
}
