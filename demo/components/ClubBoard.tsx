"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import {
  actionAddComparison,
  actionAddReferral,
  actionMeddleReferral,
  actionReset,
  actionSetNow,
  actionSetStatus,
} from "../app/actions.ts";
import {
  EVIDENCE_TYPES,
  PRODUCT_LANGUAGE,
  REFERRAL_EVIDENCE_PROMPT,
  REFERRAL_PRIMARY_PROMPT,
  SCALE_LABELS,
} from "../../src/domain/constants.ts";
import type { EvidenceType, PersonStatus, Scale5 } from "../../src/domain/types.ts";
import type { ClubState, ClubView, EngineResult, PersonView } from "../lib/types.ts";
import { JudgeSim } from "./JudgeSim.tsx";
import { PersonaGraph } from "./PersonaGraph.tsx";

function Scale({
  label,
  value,
  captions,
  onChange,
}: {
  label: string;
  value: Scale5;
  captions: Record<Scale5, string>;
  onChange: (v: Scale5) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted">
        {label} · {captions[value]}
      </span>
      <input
        type="range"
        min={1}
        max={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as Scale5)}
        className="mt-1 w-full accent-signal"
      />
    </label>
  );
}

function StatusChip({ status }: { status: PersonStatus }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
      {status}
    </span>
  );
}

export function ClubBoard({ initial }: { initial: EngineResult }) {
  const [state, setState] = useState<ClubState>(initial.state);
  const [view, setView] = useState<ClubView>(initial.view);
  const [error, setError] = useState<string | null>(initial.error ?? null);
  const [selectedId, setSelectedId] = useState<string>("p-cleo");
  const [personasOnly, setPersonasOnly] = useState(true);
  const [pending, start] = useTransition();

  const apply = (result: EngineResult) => {
    setState(result.state);
    setView(result.view);
    setError(result.error ?? null);
  };

  const selected: PersonView | undefined = useMemo(
    () => view.people.find((p) => p.id === selectedId) ?? view.people.find((p) => p.persona),
    [view.people, selectedId],
  );

  const referrers = view.people.filter((p) => p.id !== selected?.id);

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Talent Graph · owner demo</p>
          <h1 className="font-serif text-2xl tracking-tight">Who should this club look at?</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Hypothetical seed club. {PRODUCT_LANGUAGE.referralSignal} is how loud the network is.{" "}
            {PRODUCT_LANGUAGE.relativeCapability} is how they look on pairwise compares. They are never
            merged. Refresh restores the seed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>
            {view.counts.candidates} candidates · {view.counts.members} members · {view.counts.archived}{" "}
            archived · {view.counts.referrals} referrals · {view.counts.comparisons} compares
          </span>
          <button
            type="button"
            className="rounded-full border border-ink px-3 py-1 text-ink hover:bg-ink hover:text-paper"
            onClick={() => start(async () => apply(await actionReset()))}
          >
            Reset seed
          </button>
        </div>
      </header>

      {error ? (
        <div className="border-b border-amber-300 bg-amber-50 px-5 py-2 text-sm text-warn">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-12 xl:grid-rows-[auto_1fr]">
        <section className="rounded-lg border border-line bg-panel p-3 xl:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Referral network</h2>
            <label className="text-[11px] text-muted">
              <input
                type="checkbox"
                className="mr-1 accent-ink"
                checked={personasOnly}
                onChange={(e) => setPersonasOnly(e.target.checked)}
              />
              personas
            </label>
          </div>
          <PersonaGraph
            nodes={view.graph.nodes}
            edges={view.graph.edges}
            selectedId={selectedId}
            personasOnly={personasOnly}
            onSelect={setSelectedId}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Node size is not a score. Click someone to open their dossier. Cleo is quiet; Bram is loud.
            That is the product.
          </p>
        </section>

        <section className="grid gap-3 md:grid-cols-3 xl:col-span-5">
          <ListCard title={`${PRODUCT_LANGUAGE.referralSignal} · V2`} hint="network volume, judge-weighted">
            {view.topReferral.map((row) => (
              <button
                key={row.personId}
                type="button"
                onClick={() => setSelectedId(row.personId)}
                className={`flex w-full items-baseline justify-between gap-2 rounded px-1 py-1 text-left text-sm hover:bg-paper ${
                  row.personId === selectedId ? "bg-paper" : ""
                }`}
              >
                <span>
                  {row.name}
                  {row.persona ? <span className="ml-1 text-[10px] text-signal">●</span> : null}
                </span>
                <span className="font-mono text-signal">
                  {row.signal}
                  <span className="text-muted">/100</span>
                </span>
              </button>
            ))}
          </ListCard>
          <ListCard
            title={`${PRODUCT_LANGUAGE.relativeCapability}`}
            hint="percentile in its own pool, not a scalar"
          >
            {view.topCapability.map((row) => (
              <button
                key={`${row.personId}-${row.dimension}`}
                type="button"
                onClick={() => setSelectedId(row.personId)}
                className="flex w-full flex-col items-start rounded px-1 py-1 text-left text-sm hover:bg-paper"
              >
                <span className="flex w-full justify-between">
                  <span>{row.name}</span>
                  <span className="font-mono text-capability">{Math.round(row.percentile)}</span>
                </span>
                <span className="text-[10px] text-muted">
                  {row.dimensionLabel} · pool {row.poolSize} · {row.poolConfidence}
                </span>
              </button>
            ))}
          </ListCard>
          <ListCard
            title={`${PRODUCT_LANGUAGE.underRecognitionGap}`}
            hint={`${PRODUCT_LANGUAGE.exploratory} · capability ≫ network`}
          >
            {view.underRecognized.map((row) => (
              <button
                key={`${row.personId}-${row.dimension}`}
                type="button"
                onClick={() => setSelectedId(row.personId)}
                className="flex w-full flex-col items-start rounded px-1 py-1 text-left text-sm hover:bg-paper"
              >
                <span className="flex w-full justify-between">
                  <span>{row.name}</span>
                  <span className="font-mono text-gap">+{Math.round(row.gap)}</span>
                </span>
                <span className="text-[10px] text-muted">{row.dimensionLabel}</span>
              </button>
            ))}
          </ListCard>
        </section>

        <section className="board-scroll max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-panel p-4 xl:col-span-4 xl:max-h-[calc(100vh-8rem)]">
          {selected ? (
            <Dossier
              person={selected}
              busy={pending}
              referrers={referrers}
              onStatus={(status) =>
                start(async () => apply(await actionSetStatus(state, selected.id, status)))
              }
              onMeddle={(id, patch) =>
                start(async () => apply(await actionMeddleReferral(state, id, patch)))
              }
              onRefer={(input) => start(async () => apply(await actionAddReferral(state, input)))}
            />
          ) : (
            <p className="text-sm text-muted">Select someone in the graph.</p>
          )}
        </section>

        <section className="rounded-lg border border-line bg-panel p-4 xl:col-span-7">
          <ComparePanel
            view={view}
            busy={pending}
            onCompare={(outcome) => {
              const next = view.nextCompare;
              if (!next) return;
              start(async () =>
                apply(
                  await actionAddComparison(state, {
                    personAId: next.personAId,
                    personBId: next.personBId,
                    dimension: next.dimension,
                    outcome,
                  }),
                ),
              );
            }}
          />
        </section>

        <section className="rounded-lg border border-line bg-panel p-4 xl:col-span-5">
          <JudgeSim
            view={view}
            busy={pending}
            onPickTime={(now) => start(async () => apply(await actionSetNow(state, now)))}
            onSelectJudge={setSelectedId}
          />
        </section>
      </div>
    </div>
  );
}

function ListCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mb-2 text-[10px] text-muted">{hint}</p>
      <div className="board-scroll max-h-72 space-y-0.5 overflow-y-auto">{children}</div>
    </div>
  );
}

function Dossier({
  person,
  busy,
  referrers,
  onStatus,
  onMeddle,
  onRefer,
}: {
  person: PersonView;
  busy: boolean;
  referrers: PersonView[];
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
  const [referrerId, setReferrerId] = useState(referrers[0]?.id ?? "");
  const [conviction, setConviction] = useState<Scale5>(4);
  const [confidence, setConfidence] = useState<Scale5>(4);
  const [depth, setDepth] = useState<Scale5>(3);
  const [evidenceType, setEvidenceType] = useState<EvidenceType>("firsthand_work");
  const [evidenceText, setEvidenceText] = useState("");

  const delta = person.v2Signal - person.v0Signal;

  return (
    <div className={busy ? "opacity-70" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-serif text-xl">{person.name}</h2>
          <p className="text-xs text-muted">
            {person.affiliation || "Unaffiliated"}
            {person.bio ? ` · ${person.bio}` : ""}
          </p>
        </div>
        <StatusChip status={person.status} />
      </div>
      {person.note ? <p className="mt-2 text-sm italic text-ink/80">{person.note}</p> : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-full bg-capability px-3 py-1 text-xs text-white"
          onClick={() => onStatus("member")}
        >
          Accept as member
        </button>
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1 text-xs"
          onClick={() => onStatus("archived")}
        >
          Archive
        </button>
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1 text-xs"
          onClick={() => onStatus("candidate")}
        >
          Back to candidate
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-y border-line py-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">{PRODUCT_LANGUAGE.referralSignal}</p>
          <p className="font-mono text-3xl text-signal">{person.v2Signal}</p>
          <p className="text-[11px] text-muted">
            V0 {person.v0Signal}
            {delta !== 0 ? ` → V2 ${person.v2Signal} (${delta > 0 ? "+" : ""}${delta})` : " · judges have not moved this number"}
            {" · "}
            {person.incomingCount} incoming · {person.firsthandCount} firsthand
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">{PRODUCT_LANGUAGE.relativeCapability}</p>
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
                {Math.round(d.percentile ?? 0)}th · {d.comparisonCount} cmp · pool {d.poolSize}
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
        <p className="mt-3 text-xs text-gap">
          {PRODUCT_LANGUAGE.underRecognitionGap} +
          {Math.round(Math.max(...person.gaps.map((g) => g.gap)))} · {PRODUCT_LANGUAGE.exploratory}
        </p>
      ) : null}

      <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-muted">
        Contributing referrals — meddle
      </h3>
      <p className="text-[11px] text-muted">
        Sliders rewrite the original prediction in place (updatedAt stays put) so V2 still scores it.
      </p>
      <ul className="mt-2 space-y-3">
        {person.contributing.map((c) => (
          <li key={c.referralId} className="rounded border border-line p-2">
            <p className="text-sm">
              {c.referrerName}{" "}
              <span className="font-mono text-xs text-muted">
                R {c.strength.toFixed(2)} · p̂ {c.reliability.toFixed(2)} · {c.evidenceType}
              </span>
            </p>
            <Scale
              label="Conviction"
              value={c.conviction}
              captions={SCALE_LABELS.conviction}
              onChange={(conviction) =>
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
              onChange={(confidence) =>
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
              onChange={(relationshipDepth) =>
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

      <form
        className="mt-5 space-y-2 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!referrerId || evidenceText.trim() === "") return;
          onRefer({
            referrerId,
            candidateId: person.id,
            conviction,
            confidence,
            relationshipDepth: depth,
            evidenceType,
            evidenceText,
          });
          setEvidenceText("");
        }}
      >
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Write a referral</h3>
        <p className="text-sm">{REFERRAL_PRIMARY_PROMPT}</p>
        <select
          className="w-full border border-line bg-paper px-2 py-1 text-sm"
          value={referrerId}
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
          className="w-full border border-line bg-paper px-2 py-2 text-sm"
          placeholder={REFERRAL_EVIDENCE_PROMPT}
          value={evidenceText}
          onChange={(e) => setEvidenceText(e.target.value)}
        />
        <select
          className="w-full border border-line bg-paper px-2 py-1 text-sm"
          value={evidenceType}
          onChange={(e) => setEvidenceType(e.target.value as EvidenceType)}
        >
          {EVIDENCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Scale label="Conviction" value={conviction} captions={SCALE_LABELS.conviction} onChange={setConviction} />
        <Scale label="Confidence" value={confidence} captions={SCALE_LABELS.confidence} onChange={setConfidence} />
        <Scale label="Relationship" value={depth} captions={SCALE_LABELS.relationshipDepth} onChange={setDepth} />
        <button type="submit" className="rounded-full bg-ink px-4 py-1.5 text-sm text-paper">
          Add referral
        </button>
      </form>
    </div>
  );
}

function ComparePanel({
  view,
  busy,
  onCompare,
}: {
  view: ClubView;
  busy: boolean;
  onCompare: (outcome: "a" | "b" | "tie" | "skip" | "insufficient_observation") => void;
}) {
  const next = view.nextCompare;
  return (
    <div className={busy ? "opacity-70" : ""}>
      <h2 className="text-sm font-medium">Next compare</h2>
      {next ? (
        <>
          <p className="mt-2 text-sm">{next.prompt}</p>
          <p className="mt-1 text-xs text-muted">
            {next.dimensionLabel} · heuristic priority {next.priority.toFixed(2)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full bg-capability px-4 py-1.5 text-sm text-white"
              onClick={() => onCompare("a")}
            >
              {next.personAName}
            </button>
            <button
              type="button"
              className="rounded-full bg-capability px-4 py-1.5 text-sm text-white"
              onClick={() => onCompare("b")}
            >
              {next.personBName}
            </button>
            <button
              type="button"
              className="rounded-full border border-line px-3 py-1.5 text-sm"
              onClick={() => onCompare("tie")}
            >
              Tie
            </button>
            <button
              type="button"
              className="rounded-full border border-line px-3 py-1.5 text-sm"
              onClick={() => onCompare("skip")}
            >
              Skip
            </button>
            <button
              type="button"
              className="rounded-full border border-line px-3 py-1.5 text-sm"
              onClick={() => onCompare("insufficient_observation")}
            >
              {PRODUCT_LANGUAGE.notObserved}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">No pair to propose.</p>
      )}
    </div>
  );
}
