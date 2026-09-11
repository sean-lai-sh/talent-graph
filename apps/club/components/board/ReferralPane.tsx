"use client";

import { PRODUCT_LANGUAGE, SCALE_LABELS } from "../../../../src/domain/constants.ts";
import { StatusChip } from "./primitives.tsx";
import type { IncomingReferralRow } from "./referralOrigin.ts";

export function ReferralPane({
  personName,
  network,
  outside,
  onClose,
  onSelectReferrer,
}: {
  personName: string;
  network: IncomingReferralRow[];
  outside: IncomingReferralRow[];
  onClose: () => void;
  onSelectReferrer: (id: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col rounded-lg border border-line bg-panel">
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-3">
        <div>
          <h2 className="text-sm font-medium">Who referred {personName}</h2>
          <p className="mt-0.5 text-[10px] text-muted">
            {PRODUCT_LANGUAGE.referralSignal} is a mean of incoming referrals — not a merged score
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:text-ink"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="board-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <ReferralGroup
          title="In this club"
          hint="Members, or people already on the inner network"
          rows={network}
          empty="Nobody in this club has referred them yet."
          onSelectReferrer={onSelectReferrer}
        />
        <ReferralGroup
          title="Outside this club"
          hint="A check from someone who is not a member and not on the inner network"
          rows={outside}
          empty="No outside referral yet."
          onSelectReferrer={onSelectReferrer}
        />
      </div>
    </aside>
  );
}

function ReferralGroup({
  title,
  hint,
  rows,
  empty,
  onSelectReferrer,
}: {
  title: string;
  hint: string;
  rows: IncomingReferralRow[];
  empty: string;
  onSelectReferrer: (id: string) => void;
}) {
  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      <p className="mb-2 text-[10px] text-muted">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.referral.id} className="rounded border border-line p-2">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="text-left text-sm font-medium hover:underline"
                  onClick={() => onSelectReferrer(row.referral.referrerId)}
                >
                  {row.referrer?.name ?? row.referral.referrerId}
                </button>
                {row.referrer ? <StatusChip status={row.referrer.status} /> : null}
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {row.referrer?.affiliation || "Unaffiliated"}
                {" · "}
                {row.referral.evidenceType}
                {" · "}
                {SCALE_LABELS.relationshipDepth[row.referral.relationshipDepth]}
              </p>
              <p className="mt-1 text-[11px] italic text-ink/80">{row.referral.evidenceText}</p>
              {row.contributing ? (
                <p className="mt-1 font-mono text-[10px] text-muted">
                  entered {PRODUCT_LANGUAGE.referralSignal}
                  {" · "}p̂·R {row.contributing.strength.toFixed(2)}
                  {" · "}p̂ {row.contributing.reliability.toFixed(2)}
                </p>
              ) : (
                <p className="mt-1 text-[10px] text-muted">
                  Real referral; did not enter {PRODUCT_LANGUAGE.referralSignal}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
