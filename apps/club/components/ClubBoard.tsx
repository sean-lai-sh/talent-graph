"use client";

import {
  Children,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  EVIDENCE_TYPES,
  PRODUCT_LANGUAGE,
  REFERRAL_EVIDENCE_PROMPT,
  REFERRAL_PRIMARY_PROMPT,
  SCALE_LABELS,
} from "../../../src/domain/constants.ts";
import type { EvidenceType, PersonStatus, Scale5 } from "../../../src/domain/types.ts";
import {
  actionAddComparison,
  actionAddReferral,
  actionMeddleReferral,
  actionReset,
  actionSetNow,
  actionSetStatus,
} from "../app/actions.ts";
import { describeActionError } from "../lib/actionError.ts";
import type {
  ClubBoardActions,
  ClubSnapshot,
  ClubState,
  ClubView,
  EngineResult,
  PersonView,
  SignalRow,
} from "../lib/types.ts";
import { JudgeSim } from "./JudgeSim.tsx";
import { PersonaGraph } from "./PersonaGraph.tsx";

function ordinal(n: number): string {
  const v = Math.round(n);
  const mod10 = v % 10;
  const mod100 = v % 100;
  if (mod10 === 1 && mod100 !== 11) return `${v}st`;
  if (mod10 === 2 && mod100 !== 12) return `${v}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${v}rd`;
  return `${v}th`;
}

function Scale({
  label,
  value,
  captions,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  value: Scale5;
  captions: Record<Scale5, string>;
  onChange?: (v: Scale5) => void;
  onCommit?: (v: Scale5) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<Scale5>(value);
  const [seen, setSeen] = useState<Scale5>(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  const set = (next: Scale5) => {
    setDraft(next);
    onChange?.(next);
  };

  const commit = () => {
    if (onCommit && draft !== value) onCommit(draft);
  };

  return (
    <label className="block text-xs">
      <span className="text-muted">
        {label} · {captions[draft]}
      </span>
      <input
        type="range"
        min={1}
        max={5}
        value={draft}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value) as Scale5)}
        onPointerUp={commit}
        onKeyUp={commit}
        className="mt-1 w-full accent-signal disabled:opacity-50"
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

export function ClubBoard({
  initial,
  variant = "example",
  actions,
  sync,
}: {
  initial: EngineResult;
  variant?: "example" | "club";
  actions?: Partial<ClubBoardActions>;
  sync?: EngineResult | null;
}) {
  const run: ClubBoardActions = {
    setNow: actions?.setNow ?? actionSetNow,
    setStatus: actions?.setStatus ?? actionSetStatus,
    addReferral: actions?.addReferral ?? actionAddReferral,
    meddleReferral: actions?.meddleReferral ?? actionMeddleReferral,
    addComparison: actions?.addComparison ?? actionAddComparison,
    addPerson: actions?.addPerson,
    reset: actions?.reset ?? (variant === "example" ? actionReset : undefined),
  };
  const firstId =
    initial.view.people.find((p) => p.id === "p-cleo")?.id ?? initial.view.people[0]?.id ?? "";
  const [state, setState] = useState<ClubState>(initial.state);
  const [view, setView] = useState<ClubView>(initial.view);
  const [error, setError] = useState<string | null>(initial.error ?? null);
  const [selectedId, setSelectedId] = useState<string>(firstId);
  const [personasOnly, setPersonasOnly] = useState(true);
  const [dossierEpoch, setDossierEpoch] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [pending, start] = useTransition();
  const stateRef = useRef(state);
  const chainRef = useRef(Promise.resolve());

  const apply = (result: EngineResult) => {
    setState(result.state);
    setView(result.view);
    setError(result.error ?? null);
    stateRef.current = result.state;
    setSelectedId((id) =>
      result.view.people.some((p) => p.id === id) ? id : (result.view.people[0]?.id ?? ""),
    );
  };

  useEffect(() => {
    if (!sync) return;
    setState(sync.state);
    setView(sync.view);
    setError(sync.error ?? null);
    stateRef.current = sync.state;
    setSelectedId((id) =>
      sync.view.people.some((p) => p.id === id) ? id : (sync.view.people[0]?.id ?? ""),
    );
  }, [sync]);

  const mutate = (fn: (latest: ClubState) => Promise<EngineResult>, opts?: { seed?: boolean }) => {
    chainRef.current = chainRef.current
      .then(async () => {
        const result = await fn(stateRef.current);
        apply(result);
        if (opts?.seed) setDirty(false);
        else if (!result.error) setDirty(true);
      })
      .catch((err: unknown) => {
        setError(describeActionError(err));
      });
    start(async () => {
      try {
        await chainRef.current;
      } catch (err) {
        setError(describeActionError(err));
      }
    });
  };

  const resetToSeed = () => {
    if (!run.reset) return;
    mutate(
      async () => {
        const result = await run.reset?.();
        if (!result) return { state: stateRef.current, view };
        setSelectedId("p-cleo");
        setDossierEpoch((n) => n + 1);
        return result;
      },
      { seed: true },
    );
  };

  const selected: PersonView | undefined = useMemo(
    () => view.people.find((p) => p.id === selectedId) ?? view.people.find((p) => p.persona),
    [view.people, selectedId],
  );

  const referrers = view.people.filter((p) => p.id !== selected?.id);

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="board-header sticky top-0 z-10 flex flex-wrap items-end justify-between gap-3 border-b border-line bg-paper px-4 py-3 sm:px-5 sm:py-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
            {variant === "club" ? "Talent Graph · your club" : "Talent Graph · example admin"}
          </p>
          <h1 className="font-serif text-xl tracking-tight sm:text-2xl">
            Who should this club look at?
          </h1>
          <p className="mt-1 hidden max-w-2xl text-sm text-muted md:block">
            {variant === "club" ? (
              <>
                Members, referrals, and status persist in Convex. Views are computed by{" "}
                <code className="font-mono text-[12px]">src/</code> — not copied here. The public
                example stays open at / and /example with no sign-in.
              </>
            ) : (
              <>
                You are the admin of this public example club. {PRODUCT_LANGUAGE.referralSignal} is
                how loud the network is. {PRODUCT_LANGUAGE.relativeCapability} is how they look on
                pairwise compares. They are never merged. Reset to seed restores this example. No
                sign-in.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="hidden lg:inline">
            {view.counts.candidates} candidates · {view.counts.members} members ·{" "}
            {view.counts.archived} archived · {view.counts.referrals} referrals ·{" "}
            {view.counts.comparisons} compares
          </span>
          {variant === "example" && dirty ? (
            <span className="text-warn">Local edits · not the seed</span>
          ) : null}
          {variant === "club" && run.addPerson ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const name = newPersonName.trim();
                if (!name || !run.addPerson) return;
                mutate(async (latest) => {
                  const result = await run.addPerson?.(latest, { name });
                  if (!result) return { state: latest, view };
                  if (!result.error) {
                    const created = result.state.people.find(
                      (p) => !latest.people.some((row) => row.id === p.id),
                    );
                    if (created) setSelectedId(created.id);
                  }
                  return result;
                });
                setNewPersonName("");
              }}
            >
              <input
                className="rounded border border-line bg-paper px-2 py-1 text-ink"
                name="personName"
                placeholder="Add a person"
                value={newPersonName}
                onChange={(event) => setNewPersonName(event.target.value)}
              />
              <button
                type="submit"
                className="rounded-full bg-ink px-3 py-1 text-paper hover:opacity-90"
              >
                Add
              </button>
            </form>
          ) : null}
          {run.reset ? (
            <button
              type="button"
              className={
                dirty
                  ? "rounded-full bg-ink px-3 py-1 text-paper hover:opacity-90"
                  : "rounded-full border border-ink px-3 py-1 text-ink hover:bg-ink hover:text-paper"
              }
              onClick={resetToSeed}
            >
              Reset to seed
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-start justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-warn sm:px-5"
        >
          <div>
            <p className="font-medium">Action did not apply</p>
            <p>{error}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full border border-warn px-3 py-1 text-xs"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
            {run.reset ? (
              <button
                type="button"
                className="rounded-full bg-ink px-3 py-1 text-xs text-paper"
                onClick={resetToSeed}
              >
                Reset to seed
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:gap-4 sm:p-4 xl:grid-cols-12 xl:grid-rows-[auto_1fr]">
        <section className="rounded-lg border border-line bg-panel p-3 sm:col-span-1 xl:col-span-3">
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
            Circle size follows {PRODUCT_LANGUAGE.referralSignal} (V2) when there is incoming
            evidence. A dashed circle is {PRODUCT_LANGUAGE.insufficientEvidence} — missing evidence,
            not a score of 0. Solid edges contributed to the signal; dashed edges are real referrals
            that did not. Cleo is quiet; Bram is loud.
            {personasOnly
              ? ""
              : " Personas stay on the inner ring; other people sit outside so the graph stays readable."}
          </p>
        </section>

        <section className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-3 sm:col-span-1 sm:grid-cols-1 xl:col-span-5 xl:grid-cols-3">
          <ListCard
            title={`${PRODUCT_LANGUAGE.referralSignal} · V2`}
            hint="network volume, judge-weighted · loud and quiet on load"
            empty={`No one has incoming referrals. ${PRODUCT_LANGUAGE.insufficientEvidence}.`}
            hasItems={view.topReferral.length > 0}
          >
            <ReferralLists
              rows={view.topReferral}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </ListCard>
          <ListCard
            title={PRODUCT_LANGUAGE.relativeCapability}
            hint="percentile in its own pool · not a network score"
            empty={`No dimension has enough compares. ${PRODUCT_LANGUAGE.insufficientEvidence}.`}
          >
            {view.topCapability.map((row) => (
              <button
                key={`${row.personId}-${row.dimension}`}
                type="button"
                onClick={() => setSelectedId(row.personId)}
                className={`flex w-full flex-col items-start rounded border-l-2 border-capability/40 px-2 py-1 text-left text-sm hover:bg-paper ${
                  row.personId === selectedId ? "bg-paper" : ""
                }`}
              >
                <span className="flex w-full justify-between gap-2">
                  <span>{row.name}</span>
                  <span className="text-xs text-capability">{ordinal(row.percentile)}</span>
                </span>
                <span className="text-[10px] text-muted">
                  {row.dimensionLabel} · pool {row.poolSize} · {row.poolConfidence}
                </span>
              </button>
            ))}
          </ListCard>
          <ListCard
            title={PRODUCT_LANGUAGE.exploratory}
            hint={`${PRODUCT_LANGUAGE.underRecognitionGap} · V2 vs capability · both inputs`}
            empty="No exploratory gap on this club."
          >
            {view.underRecognized.map((row) => (
              <button
                key={`${row.personId}-${row.dimension}`}
                type="button"
                onClick={() => setSelectedId(row.personId)}
                className={`flex w-full flex-col items-start rounded px-1 py-1 text-left text-sm hover:bg-paper ${
                  row.personId === selectedId ? "bg-paper" : ""
                }`}
              >
                <span className="flex w-full justify-between gap-2">
                  <span>{row.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-gap">
                    {PRODUCT_LANGUAGE.exploratory}
                  </span>
                </span>
                <span className="text-[10px] text-muted">
                  {row.dimensionLabel} · cap {ordinal(row.capabilityPercentile)} · V2{" "}
                  {ordinal(row.referralPercentile)}
                  {row.gap >= 0 ? " · +" : " · "}
                  {Math.round(row.gap)}
                </span>
              </button>
            ))}
          </ListCard>
        </section>

        <section className="rounded-lg border border-line bg-panel p-4 sm:col-span-2 xl:col-span-4 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
          {selected ? (
            <Dossier
              key={`${selected.id}:${dossierEpoch}`}
              person={selected}
              busy={pending}
              referrers={referrers}
              snapshots={view.snapshots}
              onStatus={(status) => mutate((latest) => run.setStatus(latest, selected.id, status))}
              onMeddle={(id, patch) => mutate((latest) => run.meddleReferral(latest, id, patch))}
              onRefer={(input) => mutate((latest) => run.addReferral(latest, input))}
            />
          ) : (
            <p className="text-sm text-muted">
              {variant === "club"
                ? "Nobody is selected. Add a person to start this club."
                : "Nobody is selected. Pick a person on the graph, or reset to seed to open Cleo."}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-line bg-panel p-4 sm:col-span-1 xl:col-span-7">
          <ComparePanel
            view={view}
            busy={pending}
            onCompare={(outcome) => {
              const next = view.nextCompare;
              if (!next) return;
              mutate((latest) =>
                run.addComparison(latest, {
                  personAId: next.personAId,
                  personBId: next.personBId,
                  dimension: next.dimension,
                  outcome,
                }),
              );
            }}
          />
        </section>

        <section className="rounded-lg border border-line bg-panel p-4 sm:col-span-1 xl:col-span-5">
          <JudgeSim
            view={view}
            busy={pending}
            onPickTime={(now) => mutate((latest) => run.setNow(latest, now))}
            onSelectJudge={setSelectedId}
          />
        </section>
      </div>
    </div>
  );
}

function ReferralLists({
  rows,
  selectedId,
  onSelect,
}: {
  rows: SignalRow[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const loud = rows.filter((row) => row.signal > 20).slice(0, 6);
  const quiet = rows.filter((row) => row.signal <= 20);
  return (
    <>
      <p className="px-1 pt-1 text-[10px] uppercase tracking-wide text-muted">Loud</p>
      {loud.length === 0 ? (
        <p className="px-1 text-[11px] text-muted">
          No loud {PRODUCT_LANGUAGE.referralSignal} on this club.
        </p>
      ) : (
        loud.map((row) => (
          <SignalButton
            key={row.personId}
            row={row}
            selected={row.personId === selectedId}
            onSelect={onSelect}
          />
        ))
      )}
      <p className="px-1 pt-2 text-[10px] uppercase tracking-wide text-muted">Quiet</p>
      {quiet.length === 0 ? (
        <p className="px-1 text-[11px] text-muted">
          No quiet measured {PRODUCT_LANGUAGE.referralSignal}.
        </p>
      ) : (
        quiet.map((row) => (
          <SignalButton
            key={row.personId}
            row={row}
            selected={row.personId === selectedId}
            onSelect={onSelect}
          />
        ))
      )}
    </>
  );
}

function SignalButton({
  row,
  selected,
  onSelect,
}: {
  row: SignalRow;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.personId)}
      className={`flex w-full items-baseline justify-between gap-2 rounded px-1 py-1 text-left text-sm hover:bg-paper ${
        selected ? "bg-paper" : ""
      }`}
    >
      <span>
        {row.name}
        {row.persona ? <span className="ml-1 text-[10px] text-signal">●</span> : null}
        <span className="ml-1 text-[10px] text-muted">{row.incomingCount} in</span>
      </span>
      <span className="font-mono text-signal">
        {row.signal}
        <span className="text-muted">/100</span>
      </span>
    </button>
  );
}

function ListCard({
  title,
  hint,
  empty,
  hasItems,
  children,
}: {
  title: string;
  hint: string;
  empty: string;
  hasItems?: boolean;
  children: ReactNode;
}) {
  const showEmpty = hasItems === undefined ? Children.count(children) === 0 : !hasItems;
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mb-2 text-[10px] text-muted">{hint}</p>
      <div className="board-scroll max-h-56 space-y-0.5 overflow-y-auto xl:max-h-72">
        {showEmpty ? <p className="text-[11px] text-muted">{empty}</p> : children}
      </div>
    </div>
  );
}

function Dossier({
  person,
  busy,
  referrers,
  snapshots,
  onStatus,
  onMeddle,
  onRefer,
}: {
  person: PersonView;
  busy: boolean;
  referrers: PersonView[];
  snapshots: ClubSnapshot[];
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

  const measured = person.incomingCount >= 1 && person.v2Signal !== null;
  const delta =
    measured && person.v0Signal !== null && person.v2Signal !== null
      ? person.v2Signal - person.v0Signal
      : 0;

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
          disabled={busy || person.status === "member"}
          className="rounded-full bg-capability px-3 py-1 text-xs text-white disabled:opacity-40"
          onClick={() => onStatus("member")}
        >
          Accept as member
        </button>
        <button
          type="button"
          disabled={busy || person.status === "archived"}
          className="rounded-full border border-line px-3 py-1 text-xs disabled:opacity-40"
          onClick={() => onStatus("archived")}
        >
          Archive
        </button>
        <button
          type="button"
          disabled={busy || person.status === "candidate"}
          className="rounded-full border border-line px-3 py-1 text-xs disabled:opacity-40"
          onClick={() => onStatus("candidate")}
        >
          Back to candidate
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-y border-line py-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">
            {PRODUCT_LANGUAGE.referralSignal}
          </p>
          {measured ? (
            <>
              <p className="font-mono text-3xl text-signal">{person.v2Signal}</p>
              <p className="text-[11px] text-muted">
                V0 {person.v0Signal}
                {delta !== 0
                  ? ` → V2 ${person.v2Signal} (${delta > 0 ? "+" : ""}${delta})`
                  : " · judges have not moved this number"}
                {" · "}
                {person.incomingCount} incoming · {person.firsthandCount} firsthand
              </p>
            </>
          ) : (
            <>
              <p className="text-lg text-muted">{PRODUCT_LANGUAGE.insufficientEvidence}</p>
              <p className="text-[11px] text-muted">
                No incoming referrals. Missing evidence is not low ability.
              </p>
            </>
          )}
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
                R {c.strength.toFixed(2)} · p̂ {c.reliability.toFixed(2)} · {c.evidenceType}
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

      <form
        className="mt-5 space-y-2 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || !referrerId || evidenceText.trim() === "") return;
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
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
          Write a referral · {PRODUCT_LANGUAGE.structuredEvidence}
        </h3>
        <p className="text-sm">{REFERRAL_PRIMARY_PROMPT}</p>
        <select
          className="w-full border border-line bg-paper px-2 py-1 text-sm"
          value={referrerId}
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
              disabled={busy}
              className="rounded-full bg-capability px-4 py-1.5 text-sm text-white disabled:opacity-40"
              onClick={() => onCompare("a")}
            >
              {next.personAName}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-full bg-capability px-4 py-1.5 text-sm text-white disabled:opacity-40"
              onClick={() => onCompare("b")}
            >
              {next.personBName}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40"
              onClick={() => onCompare("tie")}
            >
              Tie
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40"
              onClick={() => onCompare("skip")}
            >
              Skip
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40"
              onClick={() => onCompare("insufficient_observation")}
            >
              {PRODUCT_LANGUAGE.notObserved}
              <span className="sr-only"> ({SCALE_LABELS.rubricNotObserved})</span>
            </button>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">No pair to propose.</p>
      )}
    </div>
  );
}
