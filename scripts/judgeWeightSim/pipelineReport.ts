/**
 * The club-pipeline report: the adapted S1–S6 under each variant (hard-no A
 * against B, spread against concentrated inbound, class year in the fits on
 * and off, the r10 decision date against one that reaches the council, and
 * more advocate discretion), the early-harm and freshman measures, and a
 * sweep of κ_a, κ, h and M around the pipeline set.
 */

import { type Params, R10_DEFAULTS, stdev } from "./model.ts";
import {
  evaluatePipeline,
  FOUNDERS,
  founderOrder,
  goodFreshman,
  PIPELINE_CRITERIA,
  type PipelineConfig,
  type PipelineCriterionResult,
  type PipelineResult,
} from "./pipeline.ts";
import { MONTH } from "./world.ts";

/**
 * The pipeline set: r10 with the centred admission credit and class year in
 * the fits, and the decision date moved to the council's (day 150 of the
 * semester), since r10's 60 days ends before any council has met.
 */
export const PIPELINE_PARAMS: Params = {
  ...R10_DEFAULTS,
  centredAdmission: true,
  yearInFits: true,
  D: 150,
};

const BASE: Omit<PipelineConfig, "seed"> = {
  name: "club",
  inboundMode: "spread",
  hardNo: "recorded",
  options: 2,
};

const VARIANTS: { label: string; config: Omit<PipelineConfig, "seed">; params: Params }[] = [
  { label: "base (B, spread)", config: BASE, params: PIPELINE_PARAMS },
  { label: "hard no A", config: { ...BASE, hardNo: "scored" }, params: PIPELINE_PARAMS },
  {
    label: "concentrated",
    config: { ...BASE, inboundMode: "concentrated" },
    params: PIPELINE_PARAMS,
  },
  { label: "no class year", config: BASE, params: { ...PIPELINE_PARAMS, yearInFits: false } },
  { label: "D = 60 (r10)", config: BASE, params: { ...PIPELINE_PARAMS, D: 60 } },
  { label: "best of 5", config: { ...BASE, options: 5 }, params: PIPELINE_PARAMS },
  { label: "best of 20", config: { ...BASE, options: 20 }, params: PIPELINE_PARAMS },
];

const fmt = (x: number, digits = 3): string =>
  Number.isNaN(x) ? "n/a" : Number.isFinite(x) ? x.toFixed(digits) : String(x);
const mean = (xs: number[]): number =>
  xs.length === 0 ? Number.NaN : xs.reduce((s, x) => s + x, 0) / xs.length;

function table(rows: string[][]): string {
  const widths = (rows[0] ?? []).map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ")).join("\n");
}

/** Founders' weight spread at a month: the only judges there are early on. */
const founderSpread = (r: PipelineResult, month: number): number =>
  stdev(FOUNDERS.map((f) => r.run.monthly.get(f.id)?.[month - 1] ?? Number.NaN));

/** Share of a round's admitted who would change under the unweighted signal. */
const councilShift = (r: PipelineResult, rounds: number[]): number =>
  mean(r.run.councilDiffs.filter((_, i) => rounds.includes(i)).map((d) => d.differ / d.quota));

const gateMonth = (r: PipelineResult): number =>
  r.run.gateOpenedDay === null ? Number.NaN : Math.ceil((r.run.gateOpenedDay + 1) / MONTH);

/** Share of freshman calls that were hard no's, in a semester. */
const freshNoRate = (r: PipelineResult, semester: number): number => {
  const calls = r.calls.filter((c) => c.channel === "outbound" && c.semester === semester);
  return calls.length === 0
    ? Number.NaN
    : calls.filter((c) => c.outcome === "no").length / calls.length;
};

/** Good freshmen (a breakout, or slope half a sd above the mean) who never reached the council. */
function goodLost(r: PipelineResult): { lost: number; good: number } {
  const council = r.world.council;
  const reached = new Set(
    council.kind === "quota" ? council.rounds.flatMap((x) => x.candidates) : [],
  );
  const good = r.world.candidates.filter((c) => c.channel === "outbound" && goodFreshman(c));
  return { lost: good.filter((c) => !reached.has(c.id)).length, good: good.length };
}

export function printPipeline(detailSeeds: number[]): void {
  console.log("\n== The club pipeline: 6 semesters, ~150 candidates and 12 admissions each ==");
  const show = Object.entries(PIPELINE_PARAMS)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  console.log(`params: ${show}\n`);
  const evaluated = VARIANTS.map((v) => ({
    ...v,
    ...evaluatePipeline(v.config, v.params, detailSeeds),
  }));

  const rows = [["criterion", "threshold", ...evaluated.map((v) => v.label)]];
  PIPELINE_CRITERIA.forEach((c, i) => {
    rows.push([
      c.id,
      c.threshold,
      ...evaluated.map((v) => {
        const r = v.results[i] as PipelineCriterionResult;
        return `${fmt(r.metric)} ${c.kind === "report" ? "info" : r.pass ? "pass" : "FAIL"}`;
      }),
    ]);
  });
  console.log(table(rows));

  const metric = (label: string, f: (r: PipelineResult) => number, digits = 2) => [
    label,
    ...evaluated.map((v) => fmt(mean(v.runs.map(f)), digits)),
  ];
  const lost = (v: (typeof evaluated)[number]) => {
    const all = v.runs.map(goodLost);
    return `${fmt(mean(all.map((x) => x.lost)), 1)} of ${fmt(mean(all.map((x) => x.good)), 1)}`;
  };
  console.log("\nMeasures (mean over detail seeds):\n");
  console.log(
    table([
      ["measure", ...evaluated.map((v) => v.label)],
      metric("skill order, month 6", (r) => founderOrder(r.run, 6)),
      metric("skill order, month 12", (r) => founderOrder(r.run, 12)),
      metric("skill order, month 24", (r) => founderOrder(r.run, 24)),
      metric("skill order, month 36", (r) => founderOrder(r.run, 36)),
      metric("founders' weight sd, month 6", (r) => founderSpread(r, 6), 3),
      metric("founders' weight sd, month 12", (r) => founderSpread(r, 12), 3),
      metric("admits changed by weighting, rounds 1–2", (r) => councilShift(r, [0, 1])),
      metric("admits changed by weighting, all rounds", (r) => councilShift(r, [0, 1, 2, 3, 4, 5])),
      metric("gate opens (month)", gateMonth, 1),
      metric("freshman hard-no rate, semester 1", (r) => freshNoRate(r, 0)),
      metric("freshman hard-no rate, semester 6", (r) => freshNoRate(r, 5)),
      metric("callers' freshman no-cut, semester 6", (r) => r.freshNoBySemester[5] ?? Number.NaN),
      ["good freshmen lost at the call stage", ...evaluated.map(lost)],
    ]),
  );
}

const AXES: Record<string, number[]> = {
  kappaA: [0.15, 0.25, 0.35],
  kappa: [0.2, 0.3, 0.45],
  h: [0.1, 0.25, 0.5],
  M: [10, 20, 30],
};

/** κ_a, κ, h and M around the pipeline set, base variant; robust share of the pipeline set. */
export function printPipelineSweep(seeds: number[]): void {
  let points: { at: number[]; params: Params }[] = [{ at: [], params: PIPELINE_PARAMS }];
  for (const [axis, values] of Object.entries(AXES)) {
    points = points.flatMap((pt) =>
      values.map((v, i) => ({ at: [...pt.at, i], params: { ...pt.params, [axis]: v } })),
    );
  }
  const scored = points.map((pt) => ({
    ...pt,
    results: evaluatePipeline(BASE, pt.params, seeds).results,
  }));
  const gatedIds = PIPELINE_CRITERIA.filter((c) => c.kind !== "report").map((c) => c.id);
  const passes = (id: string, rs: PipelineCriterionResult[]) =>
    rs.find((r) => r.criterion.id === id)?.pass ?? false;
  const passable = gatedIds.filter((id) => scored.some((s) => passes(id, s.results)));
  const passAll = (rs: PipelineCriterionResult[]) => passable.every((id) => passes(id, rs));
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= 1);
  const share = (at: number[]) => {
    const hood = scored.filter((s) => near(s.at, at));
    return hood.filter((s) => passAll(s.results)).length / hood.length;
  };
  const centre = scored.find((s) => s.at.every((v) => v === 1));
  console.log(
    `\n== Sweep around the pipeline set (κ_a, κ, h, M; base variant; seeds ${seeds.join(", ")}) ==\n`,
  );
  console.log(
    `Fail at every set (design findings, left out of "pass everything"): ${gatedIds.filter((id) => !passable.includes(id)).join(", ") || "none"}`,
  );
  console.log(
    `Pass everything: ${scored.filter((s) => passAll(s.results)).length}/${scored.length}`,
  );
  if (centre) {
    console.log(
      `Pipeline set: passes everything ${passAll(centre.results)}; robust share ${fmt(share(centre.at), 2)} of its 81 neighbours`,
    );
  }
  const best = [...scored].sort(
    (a, b) => Number(passAll(b.results)) - Number(passAll(a.results)) || share(b.at) - share(a.at),
  )[0];
  if (best) {
    console.log(
      `Best set: ${Object.keys(AXES)
        .map((k) => `${k}=${best.params[k as keyof Params] as number}`)
        .join(" ")}, robust share ${fmt(share(best.at), 2)}`,
    );
  }
  const rows = [["criterion", "passes in", "metric range"]];
  for (const id of gatedIds) {
    const ms = scored.map(
      (s) => s.results.find((r) => r.criterion.id === id)?.metric ?? Number.NaN,
    );
    rows.push([
      id,
      `${scored.filter((s) => passes(id, s.results)).length}/${scored.length}`,
      `${fmt(Math.min(...ms))} .. ${fmt(Math.max(...ms))}`,
    ]);
  }
  console.log(`\n${table(rows)}`);
}
