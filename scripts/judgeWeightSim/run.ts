#!/usr/bin/env bun
/**
 * bun run sim:judges [-- --seed <n>] [--reps <n>] [--no-sweep]
 *
 * Delivery step 0 of the r7 judge-weight spec (docs/issues/28): runs the five
 * §5 scenarios through the pure r7 model, sweeps a small grid over the most
 * consequential parameters, and prints which parameter set passes S1–S4 with
 * the widest margin while keeping S5 in bounds, how sensitive that is, and
 * the per-criterion results at that set.
 *
 * Deterministic: replicate seeds are `seed, seed + 1, …`; there is no clock,
 * network or environment read, so the same arguments print the same bytes.
 */

import { type Params, perEventBound, R7_DEFAULTS } from "./model.ts";
import {
  type CriterionResult,
  evaluateScenario,
  SCENARIOS,
  type Scenario,
  type ScenarioResult,
  type WorldCache,
} from "./scenarios.ts";
import type { WorldConfig } from "./world.ts";

/** Each axis is a list of named overrides of R7_DEFAULTS. */
const GRID: Record<string, { label: string; set: Partial<Params> }[]> = {
  kappaA: [0.25, 0.5].map((v) => ({ label: String(v), set: { kappaA: v } })),
  kappa: [5, 10].map((v) => ({ label: String(v), set: { kappa: v } })),
  beta: [1.25, 2].map((v) => ({ label: String(v), set: { beta: v } })),
  "alpha/phi": [
    { label: "0.75/0.2", set: { alpha: 0.75, phi: 0.2 } },
    { label: "1.5/0.1", set: { alpha: 1.5, phi: 0.1 } },
  ],
  b: [
    { label: "1.5/1.25/0.25", set: { b: { not_yet: 1.5, soon: 1.25, yes: 0.25 } } },
    { label: "1.2/1.1/0.8", set: { b: { not_yet: 1.2, soon: 1.1, yes: 0.8 } } },
  ],
  lambdaF: [2, 8].map((v) => ({ label: String(v), set: { lambdaF: v } })),
  h: [0, 0.02, 0.05].map((v) => ({ label: String(v), set: { h: v } })),
  M: [20, 40].map((v) => ({ label: String(v), set: { M: v } })),
};

interface GridPoint {
  labels: Record<string, string>;
  params: Params;
}

function gridPoints(): GridPoint[] {
  let points: GridPoint[] = [{ labels: {}, params: R7_DEFAULTS }];
  for (const [axis, options] of Object.entries(GRID)) {
    points = points.flatMap((pt) =>
      options.map((o) => ({
        labels: { ...pt.labels, [axis]: o.label },
        params: { ...pt.params, ...o.set },
      })),
    );
  }
  return points;
}

interface Scored {
  point: GridPoint;
  results: ScenarioResult[];
  s5InBounds: boolean;
  /** S1–S4 criteria that pass somewhere in the grid, all passing here. */
  acceptable: boolean;
  passed: number;
  /** Smallest margin among S1–S4 criteria that pass somewhere in the grid. */
  minMargin: number;
}

const flat = (results: ScenarioResult[]): CriterionResult[] => results.flatMap((r) => r.results);
const isS5 = (c: CriterionResult) => c.criterion.id.startsWith("S5");

function score(points: GridPoint[], seeds: number[]): { scored: Scored[]; passable: Set<string> } {
  const cache: WorldCache = new Map();
  const evaluated = points.map((point) => ({
    point,
    // Only the criteria are kept per grid point; the runs would hold every referral.
    results: SCENARIOS.map((s) => ({
      ...evaluateScenario(s, point.params, seeds, cache),
      runs: [],
    })),
  }));
  const passable = new Set(
    evaluated
      .flatMap((e) => flat(e.results).filter((c) => c.pass && !isS5(c)))
      .map((c) => c.criterion.id),
  );
  const scored = evaluated.map(({ point, results }) => {
    const cs = flat(results);
    const main = cs.filter((c) => !isS5(c));
    const counted = main.filter((c) => passable.has(c.criterion.id));
    return {
      point,
      results,
      s5InBounds: cs.filter(isS5).every((c) => c.pass),
      acceptable: counted.every((c) => c.pass),
      passed: main.filter((c) => c.pass).length,
      minMargin: Math.min(...counted.map((c) => c.margin)),
    };
  });
  return { scored, passable };
}

const better = (a: Scored, b: Scored): number =>
  Number(b.s5InBounds) - Number(a.s5InBounds) ||
  Number(b.acceptable) - Number(a.acceptable) ||
  b.passed - a.passed ||
  b.minMargin - a.minMargin;

const fmt = (x: number, digits = 3): string =>
  Number.isNaN(x) ? "n/a" : Number.isFinite(x) ? x.toFixed(digits) : String(x);
const pct = (num: number, den: number): string => `${((100 * num) / den).toFixed(0)}%`;

function table(rows: string[][]): string {
  const widths = (rows[0] ?? []).map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ")).join("\n");
}

function printSweep(scored: Scored[], passable: Set<string>): Scored {
  const total = scored.length;
  console.log(`\n== Sweep: ${total} parameter sets ==\n`);
  const ids = flat(scored[0]?.results ?? []).map((c) => c.criterion.id);
  const rows = [["criterion", "passes in", "metric range", "claim"]];
  for (const id of ids) {
    const cs = scored.map((s) => flat(s.results).find((c) => c.criterion.id === id));
    const metrics = cs.map((c) => c?.metric ?? Number.NaN).filter((m) => !Number.isNaN(m));
    rows.push([
      id,
      pct(cs.filter((c) => c?.pass).length, total),
      `${fmt(Math.min(...metrics))} .. ${fmt(Math.max(...metrics))}`,
      cs[0]?.criterion.claim ?? "",
    ]);
  }
  console.log(table(rows));
  const never = ids.filter((id) => !id.startsWith("S5") && !passable.has(id));
  console.log(
    `\nFails across the whole grid (design findings, excluded from the margin): ${never.length === 0 ? "none" : never.join(", ")}`,
  );

  const ranked = [...scored].sort(better);
  const best = ranked[0] as Scored;
  const acceptable = scored.filter((s) => s.s5InBounds && s.acceptable);
  console.log(
    `Acceptable sets (S5 in bounds, every passable S1–S4 criterion passing): ${acceptable.length}/${total}`,
  );
  console.log(
    `\nChosen: ${Object.entries(best.point.labels)
      .map(([k, v]) => `${k}=${v}`)
      .join(
        " ",
      )}  (S5 in bounds: ${best.s5InBounds}; S1–S4 passed ${best.passed}; min margin ${fmt(best.minMargin)})`,
  );

  console.log("\nSensitivity: share of acceptable sets and mean min margin, per value\n");
  const sens = [["parameter", "value", "acceptable", "mean min margin"]];
  for (const [axis, options] of Object.entries(GRID)) {
    for (const o of options) {
      const subset = scored.filter((s) => s.point.labels[axis] === o.label);
      const ok = subset.filter((s) => s.s5InBounds && s.acceptable).length;
      const mean = subset.reduce((sum, s) => sum + s.minMargin, 0) / subset.length;
      sens.push([axis, o.label, `${ok}/${subset.length}`, fmt(mean)]);
    }
  }
  console.log(table(sens));
  return best;
}

function printDetail(results: ScenarioResult[], p: Params): void {
  const show = Object.entries(p)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  console.log(`\n== Scenario results ==\nparams: ${show}\n`);
  const rows = [["criterion", "pass", "metric", "margin", "threshold"]];
  for (const r of results) {
    for (const c of r.results) {
      rows.push([
        c.criterion.id,
        c.pass ? "PASS" : "FAIL",
        fmt(c.metric),
        fmt(c.margin, 2),
        c.criterion.threshold,
      ]);
    }
  }
  console.log(table(rows));
  for (const r of results) {
    const first = r.runs[0];
    if (!first) continue;
    const { world, run } = first;
    console.log(
      `\n${r.scenario.id} ${r.scenario.name} (first replicate): K=${run.K} gate opened day ${run.gateOpenedDay ?? "never"}, κ_m=${fmt(run.kappaM, 2)}, referrals=${run.referrals.length}, settled=${run.referrals.filter((x) => x.settlement).length}`,
    );
    const jrows = [["judge", "role", "skill", "referrals", "w", "logit w", "label"]];
    for (const j of run.judges) {
      const spec = world.judges.find((x) => x.id === j.id);
      jrows.push([
        j.id,
        spec?.role ?? "",
        fmt(spec?.skill ?? Number.NaN, 2),
        String(j.referrals),
        fmt(j.w),
        fmt(j.logit, 2),
        j.label,
      ]);
    }
    console.log(table(jrows));
    const delta = run.maxEventDelta;
    console.log(
      `max |Δ logit w| per event: admission ${fmt(delta.admission)}, settle ${fmt(delta.settle)} (bound ${fmt(perEventBound(p))}); accuracy ${fmt(delta.accuracy)}, ramp step ${fmt(delta.intake_s12)} (neither covered by the bound)`,
    );
  }
}

/**
 * One-change variants at the chosen parameters that attribute a failing
 * criterion to one part of a scenario or one parameter. They never feed the
 * choice of parameters.
 */
const ABLATIONS: {
  label: string;
  scenario: string;
  config?: (c: WorldConfig) => WorldConfig;
  params?: Partial<Params>;
}[] = [
  { label: "S4 without coaching", scenario: "S4", config: (c) => ({ ...c, coachBoost: 0 }) },
  {
    label: "S4 without withheld evidence",
    scenario: "S4",
    config: (c) => ({ ...c, withholdUntil: null }),
  },
  { label: "S1 with dead band h = 0.02", scenario: "S1", params: { h: 0.02 } },
  { label: "S3 with dead band h = 0.02", scenario: "S3", params: { h: 0.02 } },
];

function printAblations(chosen: Params, seeds: number[]): void {
  console.log("\n== Attribution (one change each, at the chosen parameters) ==\n");
  const rows = [["variant", "criteria"]];
  for (const a of ABLATIONS) {
    const base = SCENARIOS.find((s) => s.id === a.scenario) as Scenario;
    const changeConfig = a.config ?? ((c: WorldConfig) => c);
    const variant = { ...base, config: (p: Params) => changeConfig(base.config(p)) };
    const result = evaluateScenario(variant, { ...chosen, ...a.params }, seeds);
    rows.push([
      a.label,
      result.results
        .map((c) => `${c.criterion.id} ${c.pass ? "PASS" : "FAIL"} ${fmt(c.metric)}`)
        .join(", "),
    ]);
  }
  console.log(table(rows));
}

function parseArgs(argv: string[]): { seed: number; reps: number; sweep: boolean } {
  const out = { seed: 1, reps: 5, sweep: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = Number(argv[i + 1]);
    if (arg === "--no-sweep") out.sweep = false;
    else if ((arg === "--seed" || arg === "--reps") && Number.isInteger(next) && next > 0) {
      out[arg === "--seed" ? "seed" : "reps"] = next;
      i++;
    } else {
      console.error(`unknown or invalid argument: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const seeds = Array.from({ length: args.reps }, (_, i) => args.seed + i);
  console.log(`judge-weight r7 simulation: seeds ${seeds.join(", ")}`);
  let chosen = R7_DEFAULTS;
  if (args.sweep) {
    const { scored, passable } = score(gridPoints(), seeds);
    chosen = printSweep(scored, passable).point.params;
  }
  printDetail(
    SCENARIOS.map((s) => evaluateScenario(s, chosen, seeds)),
    chosen,
  );
  printAblations(chosen, seeds);
}
