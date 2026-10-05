#!/usr/bin/env bun
/**
 * bun run sim:judges [-- --seed <n>] [--reps <n>] [--detail-reps <n>] [--no-sweep] [--centre median|neutral]
 *
 * The sweep uses `--reps` seeds (3) to fit in well under a minute; the
 * results at the chosen set and the attribution runs use `--detail-reps` (5),
 * the replicate count the r7 results were reported at.
 *
 * Delivery step 0 of the r8 judge-weight spec (docs/issues/28): runs the six
 * §5 scenarios through the pure r8 model, sweeps a small grid over the most
 * consequential parameters, and prints which parameter set passes S1–S4, S6 and
 * S6 with the widest margin while keeping S5 in bounds, how sensitive that
 * is, and the per-criterion results at that set (S6 also with the watch off).
 *
 * Deterministic: replicate seeds are `seed, seed + 1, …`; there is no clock,
 * network or environment read, so the same arguments print the same bytes.
 */

import { type Params, R8_DEFAULTS } from "./model.ts";
import {
  boundSlack,
  type CriterionResult,
  evaluateScenario,
  S6_WATCH_OFF,
  SCENARIOS,
  type Scenario,
  type ScenarioResult,
  type WorldCache,
} from "./scenarios.ts";
import type { WorldConfig } from "./world.ts";

/**
 * Each axis is a list of named overrides of R8_DEFAULTS. α/φ, the b values,
 * β and M stay at the r7 harness's chosen values: r7's sweep found them
 * roughly neutral, and the grid has to fit in well under a minute.
 */
const GRID: Record<string, { label: string; set: Partial<Params> }[]> = {
  kappaA: [0.25, 0.5].map((v) => ({ label: String(v), set: { kappaA: v } })),
  kappa: [0.3, 0.6].map((v) => ({ label: String(v), set: { kappa: v } })),
  lambdaF: [2, 8].map((v) => ({ label: String(v), set: { lambdaF: v } })),
  T: [2, 3, 5].map((v) => ({ label: String(v), set: { T: v } })),
  h: [0, 0.3, 0.6].map((v) => ({ label: String(v), set: { h: v } })),
  sFloor: [0.15, 0.3].map((v) => ({ label: String(v), set: { sFloor: v } })),
  B: [5, 20].map((v) => ({ label: String(v), set: { B: v } })),
};

interface GridPoint {
  labels: Record<string, string>;
  params: Params;
}

function gridPoints(base: Params): GridPoint[] {
  let points: GridPoint[] = [{ labels: {}, params: base }];
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
  /** S1–S4, S6 criteria that pass somewhere in the grid, all passing here. */
  acceptable: boolean;
  passed: number;
  /** Smallest margin among S1–S4, S6 criteria that pass somewhere in the grid. */
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
    const margins = counted.filter((c) => !c.criterion.binary).map((c) => c.margin);
    return {
      point,
      results,
      s5InBounds: cs.filter(isS5).every((c) => c.pass),
      acceptable: counted.every((c) => c.pass),
      passed: main.filter((c) => c.pass).length,
      minMargin: margins.length === 0 ? 0 : Math.min(...margins),
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
    `Acceptable sets (S5 in bounds, every passable S1–S4, S6 criterion passing): ${acceptable.length}/${total}`,
  );
  console.log(
    `\nChosen: ${Object.entries(best.point.labels)
      .map(([k, v]) => `${k}=${v}`)
      .join(
        " ",
      )}  (S5 in bounds: ${best.s5InBounds}; S1–S4, S6 passed ${best.passed}; min margin ${fmt(best.minMargin)})`,
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
        c.criterion.id.startsWith(`${r.scenario.id}.`)
          ? c.criterion.id
          : `${c.criterion.id} (${r.scenario.id})`,
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
      `\n${r.scenario.id} ${r.scenario.name} (first replicate): K=${run.K} gate opened day ${run.gateOpenedDay ?? "never"}, κ_m=${fmt(run.kappaM, 2)}, referrals=${run.referrals.length}, settled=${run.referrals.filter((x) => x.settle12).length}, settled at 24 months=${run.referrals.filter((x) => x.settle24).length}, escrowed=${run.referrals.filter((x) => x.factors?.contrarian && x.admission?.decision === "deny").length}, released=${run.referrals.filter((x) => x.admission?.state === "released").length}, corrections=${run.referrals.reduce((n, x) => n + x.corrections, 0)}, watch checks=${run.watch.checks.length}, regret cases=${run.watch.regret.length}`,
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
      `max |Δ logit w| per event: admission ${fmt(delta.factors)}, correction ${fmt(delta.correct)}, accuracy ${fmt(delta.accuracy)}, settle12 ${fmt(delta.settle12)}, settle24 ${fmt(delta.settle24)}, ramp step ${fmt(delta.intake_s12)}, escrow release ${fmt(delta.watch)}; smallest slack to its bound ${fmt(boundSlack(run, p))}`,
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
  { label: "S4 without committee flags", scenario: "S4", config: (c) => ({ ...c, flagRate: 0 }) },
  { label: "S4 with every flag caught", scenario: "S4", config: (c) => ({ ...c, flagRate: 1 }) },
  { label: "S4 without coaching", scenario: "S4", config: (c) => ({ ...c, coachBoost: 0 }) },
  { label: "S3 centred so fitted d averages 0", scenario: "S3", params: { centre: "neutral" } },
  { label: "S1 centred so fitted d averages 0", scenario: "S1", params: { centre: "neutral" } },
  { label: "S4 centred so fitted d averages 0", scenario: "S4", params: { centre: "neutral" } },
  { label: "S6 without the two-flat-checks exit", scenario: "S6", params: { watchFlatExit: 1000 } },
  {
    label: "S6 without escrow-eligible answers",
    scenario: "S6",
    params: { g0: 10, b: { not_yet: 1, soon: 1, yes: 0.8 } },
  },
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

interface Args {
  seed: number;
  reps: number;
  detailReps: number;
  sweep: boolean;
  /** `--centre neutral` reruns everything under the non-spec centring, for attribution. */
  centre: Params["centre"];
}

function parseArgs(argv: string[]): Args {
  const out: Args = { seed: 1, reps: 3, detailReps: 5, sweep: true, centre: "median" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = Number(argv[i + 1]);
    if (arg === "--no-sweep") out.sweep = false;
    else if (arg === "--centre" && (argv[i + 1] === "median" || argv[i + 1] === "neutral")) {
      out.centre = argv[i + 1] as Params["centre"];
      i++;
    } else if (
      (arg === "--seed" || arg === "--reps" || arg === "--detail-reps") &&
      Number.isInteger(next) &&
      next > 0
    ) {
      out[arg === "--seed" ? "seed" : arg === "--reps" ? "reps" : "detailReps"] = next;
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
  const detailSeeds = Array.from({ length: args.detailReps }, (_, i) => args.seed + i);
  console.log(
    `judge-weight r8 simulation: sweep seeds ${seeds.join(", ")}; detail seeds ${detailSeeds.join(", ")}; centre ${args.centre}`,
  );
  const base = { ...R8_DEFAULTS, centre: args.centre };
  let chosen = base;
  if (args.sweep) {
    const { scored, passable } = score(gridPoints(base), seeds);
    chosen = printSweep(scored, passable).point.params;
  }
  printDetail(
    [...SCENARIOS, S6_WATCH_OFF].map((s) => evaluateScenario(s, chosen, detailSeeds)),
    chosen,
  );
  printAblations(chosen, detailSeeds);
}
