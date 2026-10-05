#!/usr/bin/env bun
/**
 * bun run sim:judges [-- --seed <n>] [--reps <n>] [--detail-reps <n>]
 *
 * Delivery step 0 of the r9 judge-weight spec (docs/issues/28): for each of
 * the three credit curves (§3.6), sweeps a grid around the region that passed
 * under r8 with a neutral centre, picks the set whose neighbourhood passes
 * most robustly, and prints the S1–S6 results per curve, the recommended
 * curve, the watch's lift over random, top-of-scale ties with and without
 * volume scaling, one-at-a-time sensitivity and attribution runs.
 *
 * The sweep uses `--reps` seeds (3); everything after it uses `--detail-reps`
 * (5). Deterministic: no clock, network or environment read, so the same
 * arguments print the same bytes.
 */

import { type Curve, type Params, R9_DEFAULTS } from "./model.ts";
import {
  atCeiling,
  type CriterionResult,
  evaluateScenario,
  S6_WATCH_OFF,
  SCENARIOS,
  type Scenario,
  type ScenarioResult,
  type WorldCache,
  watchMetrics,
} from "./scenarios.ts";
import type { WorldConfig } from "./world.ts";

const CURVES: readonly Curve[] = ["G1", "G2", "G3"];

/**
 * Each axis is a list of values around r8's neutral-centre region (κ_a = 0.25,
 * κ = 0.3, a corner here, since r9's first sweep chose its upper edges). T, s_floor,
 * B and C stay at R9_DEFAULTS in the sweep and get one-at-a-time sensitivity
 * afterwards; λ_f = 2 is chosen by the spec.
 */
function axesFor(curve: Curve): Record<string, number[]> {
  const common = { kappaA: [0.25, 0.35, 0.5], kappa: [0.3, 0.45, 0.6] };
  if (curve === "G1") return { ...common, h: [0, 0.15, 0.3] };
  if (curve === "G2") return { ...common, h: [0.25, 0.5, 1] };
  return { ...common, h: [0.25, 0.5, 1], p: [1.25, 1.5] };
}

interface GridPoint {
  /** Index on each axis, for the neighbourhood. */
  at: number[];
  params: Params;
}

function gridFor(curve: Curve): { axes: Record<string, number[]>; points: GridPoint[] } {
  const axes = axesFor(curve);
  let points: GridPoint[] = [{ at: [], params: { ...R9_DEFAULTS, curve } }];
  for (const [axis, values] of Object.entries(axes)) {
    points = points.flatMap((pt) =>
      values.map((v, i) => ({ at: [...pt.at, i], params: { ...pt.params, [axis]: v } })),
    );
  }
  return { axes, points };
}

const flat = (results: ScenarioResult[]): CriterionResult[] => results.flatMap((r) => r.results);
const gated = (c: CriterionResult) => c.criterion.kind !== "report";
/** Pass everything that passes somewhere in any curve's grid; the rest are design findings. */
const passesAll = (results: ScenarioResult[], passable: ReadonlySet<string>) =>
  flat(results)
    .filter(gated)
    .every((c) => c.pass || !passable.has(c.criterion.id));
const minMargin = (results: ScenarioResult[]): number => {
  const ms = flat(results)
    .filter((c) => c.criterion.kind === "check")
    .map((c) => c.margin);
  return ms.length === 0 ? 0 : Math.min(...ms);
};

interface CurveSweep {
  curve: Curve;
  axes: Record<string, number[]>;
  points: { point: GridPoint; results: ScenarioResult[]; pass: boolean; margin: number }[];
  chosen: GridPoint;
  /** Share of the chosen set's neighbourhood (one grid step on every axis) that passes everything. */
  robust: number;
  neighbours: number;
}

interface Evaluated {
  curve: Curve;
  axes: Record<string, number[]>;
  points: { point: GridPoint; results: ScenarioResult[] }[];
}

function evaluateCurve(curve: Curve, seeds: number[], cache: WorldCache): Evaluated {
  const { axes, points } = gridFor(curve);
  const scenarios = SCENARIOS.filter((s) => s.sweep);
  return {
    curve,
    axes,
    // Only the criteria are kept per grid point; the runs would hold every referral.
    points: points.map((point) => ({
      point,
      results: scenarios.map((s) => ({
        ...evaluateScenario(s, point.params, seeds, cache),
        runs: [],
      })),
    })),
  };
}

function rankCurve(evaluated: Evaluated, passable: ReadonlySet<string>): CurveSweep {
  const { curve, axes } = evaluated;
  const scored = evaluated.points.map(({ point, results }) => ({
    point,
    results,
    pass: passesAll(results, passable),
    margin: minMargin(results),
  }));
  const near = (a: GridPoint, b: GridPoint) =>
    a.at.every((v, i) => Math.abs(v - (b.at[i] ?? 0)) <= 1);
  const robustness = (pt: GridPoint) => {
    const hood = scored.filter((s) => near(s.point, pt));
    return { share: hood.filter((s) => s.pass).length / hood.length, size: hood.length };
  };
  const ranked = scored
    .map((s) => ({ ...s, ...robustness(s.point) }))
    .sort((a, b) => Number(b.pass) - Number(a.pass) || b.share - a.share || b.margin - a.margin);
  const best = ranked[0] as (typeof ranked)[number];
  return {
    curve,
    axes,
    points: scored,
    chosen: best.point,
    robust: best.share,
    neighbours: best.size,
  };
}

const fmt = (x: number, digits = 3): string =>
  Number.isNaN(x) ? "n/a" : Number.isFinite(x) ? x.toFixed(digits) : String(x);

function table(rows: string[][]): string {
  const widths = (rows[0] ?? []).map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ")).join("\n");
}

const describe = (p: Params, axes: Record<string, number[]>): string =>
  Object.keys(axes)
    .map((k) => `${k}=${p[k as keyof Params] as number}`)
    .join(" ");

function printSweep(sweeps: CurveSweep[], passable: ReadonlySet<string>): void {
  console.log("\n== Sweep per curve ==\n");
  const ids = flat(sweeps[0]?.points[0]?.results ?? [])
    .filter(gated)
    .map((c) => c.criterion.id);
  const findings = ids.filter((id) => !passable.has(id));
  console.log(
    `Fail at every set of every curve (design findings, left out of "pass everything"): ${findings.join(", ") || "none"}\n`,
  );
  const rows = [["curve", "sets", "pass everything", "chosen", "robust share", "never pass"]];
  for (const s of sweeps) {
    const never = ids.filter(
      (id) => !s.points.some((pt) => flat(pt.results).find((c) => c.criterion.id === id)?.pass),
    );
    rows.push([
      s.curve,
      String(s.points.length),
      String(s.points.filter((pt) => pt.pass).length),
      describe(s.chosen.params, s.axes),
      `${fmt(s.robust, 2)} of ${s.neighbours}`,
      never.length === 0 ? "none" : never.join(", "),
    ]);
  }
  console.log(table(rows));
  console.log("\nPass rate per criterion and curve:\n");
  const prow = [["criterion", ...sweeps.map((s) => s.curve)]];
  for (const id of ids) {
    prow.push([
      id,
      ...sweeps.map((s) => {
        const n = s.points.filter(
          (pt) => flat(pt.results).find((c) => c.criterion.id === id)?.pass,
        ).length;
        return `${n}/${s.points.length}`;
      }),
    ]);
  }
  console.log(table(prow));
}

/** The spec adopts the curve with the widest robust region that also passes S3.d. */
function recommend(sweeps: CurveSweep[], detail: Map<Curve, ScenarioResult[]>): CurveSweep {
  const s3d = (c: Curve) =>
    flat(detail.get(c) ?? []).find((r) => r.criterion.id === "S3.d")?.pass ?? false;
  return [...sweeps].sort(
    (a, b) =>
      Number(s3d(b.curve)) - Number(s3d(a.curve)) ||
      b.robust - a.robust ||
      (a.curve === "G2" ? -1 : b.curve === "G2" ? 1 : 0),
  )[0] as CurveSweep;
}

function printPerCurve(detail: Map<Curve, ScenarioResult[]>): void {
  console.log("\n== S1–S6 at each curve's chosen set ==\n");
  const curves = [...detail.keys()];
  const first = detail.get(curves[0] as Curve) ?? [];
  const rows = [["criterion", "threshold", ...curves]];
  first.forEach((r, i) => {
    r.results.forEach((c, j) => {
      const label = c.criterion.id.startsWith(`${r.scenario.id}.`)
        ? c.criterion.id
        : `${c.criterion.id} (${r.scenario.id})`;
      rows.push([
        label,
        c.criterion.threshold,
        ...curves.map((curve) => {
          const cr = detail.get(curve)?.[i]?.results[j];
          if (!cr) return "";
          const verdict = cr.criterion.kind === "report" ? "report" : cr.pass ? "pass" : "FAIL";
          return `${fmt(cr.metric)} ${verdict}`;
        }),
      ]);
    });
  });
  console.log(table(rows));
}

function printScenarioDetail(results: ScenarioResult[], p: Params): void {
  for (const r of results) {
    const first = r.runs[0];
    if (!first) continue;
    const { world, run } = first;
    const settled = (k: number) => run.referrals.filter((x) => x.settlements[k]).length;
    console.log(
      `\n${r.scenario.id} ${r.scenario.name} (first replicate): K=${run.K}, gate opened day ${run.gateOpenedDay ?? "never"}, κ_m=${fmt(run.kappaM, 2)}, referrals=${run.referrals.length}, settled at 12/24/36 months=${settled(0)}/${settled(1)}/${settled(2)}, escrowed=${run.referrals.filter((x) => x.factors?.preCredential && x.admission?.decision === "deny").length}, corrections=${run.referrals.reduce((n, x) => n + x.corrections, 0)}, flags approved/reversed=${run.flags.filter((f) => f.approvedAt !== null).length}/${run.flags.filter((f) => f.reversedAt !== null).length}, watch checks=${run.watch.checks.length}`,
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
    const d = run.maxEventDelta;
    console.log(
      `max |Δ logit w| per event: admission ${fmt(d.factors)}, correction ${fmt(d.correct)}, accuracy ${fmt(d.accuracy)}, settle ${fmt(d.settle)}, re-settle ${fmt(d.resettle)}, ramp ${fmt(d.intake_s12)}, flag approval ${fmt(d.approve)}, reversal ${fmt(d.unflag)}, watch ${fmt(d.watch)}; at the soft-cap ceiling: ${atCeiling(run, p)} of ${run.judges.length}`,
    );
  }
}

function printWatch(results: ScenarioResult[]): void {
  console.log("\n== Anti-cohort watch (learning tool; pooled over the detail seeds) ==\n");
  const rows = [
    [
      "scenario",
      "checks",
      "misses found",
      "lift over random",
      "checks per miss",
      "coverage, top-weight judges",
      "coverage, bottom-weight judges",
    ],
  ];
  for (const r of results) {
    if (!["S3", "S6"].includes(r.scenario.id)) continue;
    const m = watchMetrics(r.runs.map((x) => x.run));
    rows.push([
      r.scenario.id,
      String(m.checks),
      String(m.found),
      fmt(m.lift, 2),
      fmt(m.checksPerMiss, 1),
      fmt(m.coverageTop, 2),
      fmt(m.coverageBottom, 2),
    ]);
  }
  console.log(table(rows));
}

function printTies(results: ScenarioResult[], scaled: ScenarioResult[], p: Params): void {
  console.log("\n== Top-of-scale ties (judges at tanh(Σ/T) ≥ 0.9, mean over detail seeds) ==\n");
  const rows = [["scenario", "judges", "as written", `volume-scaled (V = ${SCALE_V})`]];
  results.forEach((r, i) => {
    const mean = (rs: ScenarioResult) =>
      rs.runs.reduce((s, x) => s + atCeiling(x.run, p), 0) / Math.max(1, rs.runs.length);
    rows.push([
      r.scenario.id,
      String(r.runs[0]?.run.judges.length ?? 0),
      fmt(mean(r), 1),
      fmt(mean(scaled[i] as ScenarioResult), 1),
    ]);
  });
  console.log(table(rows));
  const changed = flat(scaled)
    .filter(gated)
    .filter((c, i) => c.pass !== (flat(results).filter(gated)[i]?.pass ?? c.pass));
  console.log(
    `\nCriteria whose verdict changes under volume scaling: ${changed.length === 0 ? "none" : changed.map((c) => `${c.criterion.id} → ${c.pass ? "pass" : "FAIL"} (${fmt(c.metric)})`).join(", ")}`,
  );
}

const SCALE_V = 10;

/** One-at-a-time changes from the chosen set, for parameters the grid holds fixed. */
const ONE_AT_A_TIME: { label: string; set: Partial<Params> }[] = [
  { label: "T = 2", set: { T: 2 } },
  { label: "T = 5", set: { T: 5 } },
  { label: "s_floor = 0.25", set: { sFloor: 0.25 } },
  { label: "s_floor = 0.35", set: { sFloor: 0.35 } },
];

function printOneAtATime(chosen: Params, seeds: number[], cache: WorldCache): void {
  console.log("\n== One-at-a-time sensitivity at the recommended set ==\n");
  const rows = [["change", "passes everything", "failing"]];
  for (const o of ONE_AT_A_TIME) {
    const results = SCENARIOS.map((s) =>
      evaluateScenario(s, { ...chosen, ...o.set }, seeds, cache),
    );
    const failing = flat(results)
      .filter(gated)
      .filter((c) => !c.pass)
      .map((c) => `${c.criterion.id} ${fmt(c.metric)}`);
    rows.push([o.label, String(failing.length === 0), failing.join(", ") || "none"]);
  }
  const watchRows = [["watch size", "S6 checks", "found", "lift", "checks per miss"]];
  for (const set of [
    { B: 10, C: 4 },
    { B: 20, C: 2 },
    { B: 20, C: 8 },
    { B: 40, C: 4 },
  ]) {
    const s6 = SCENARIOS.find((s) => s.id === "S6") as Scenario;
    const m = watchMetrics(
      evaluateScenario(s6, { ...chosen, ...set }, seeds, cache).runs.map((x) => x.run),
    );
    watchRows.push([
      `B=${set.B} C=${set.C}`,
      String(m.checks),
      String(m.found),
      fmt(m.lift, 2),
      fmt(m.checksPerMiss, 1),
    ]);
  }
  console.log(table(rows));
  console.log();
  console.log(table(watchRows));
}

/**
 * One-change variants at the recommended set that attribute a failing
 * criterion to one cause. They never feed the choice of parameters.
 */
const ABLATIONS: {
  label: string;
  scenario: string;
  config?: (c: WorldConfig) => WorldConfig;
  params?: Partial<Params>;
}[] = [
  { label: "S6 with escrow on every denial (g0 = −∞)", scenario: "S6", params: { g0: -1e9 } },
  {
    label: "S6 with escrow on every denial and accuracy held at μ0",
    scenario: "S6",
    params: { g0: -1e9, lambda: 1e9 },
  },
  {
    label: "S6 with submitted evidence in 30% of months",
    scenario: "S6",
    config: (c) => ({ ...c, ood: c.ood ? { ...c.ood, pSubmitted: 0.3 } : null }),
  },
  {
    label: "S4 with recognition stakes all 1",
    scenario: "S4",
    params: { b: { not_yet: 1, soon: 1, yes: 1 } },
  },
  { label: "S4 without committee flags", scenario: "S4", config: (c) => ({ ...c, flagRate: 0 }) },
  {
    label: "S4 with two non-judge committee members",
    scenario: "S4",
    config: (c) => ({ ...c, extraCommittee: ["k1", "k2"] }),
  },
];

function printAblations(chosen: Params, seeds: number[], cache: WorldCache): void {
  console.log("\n== Attribution (one change each, at the recommended set) ==\n");
  const rows = [["variant", "criteria"]];
  for (const a of ABLATIONS) {
    const base = SCENARIOS.find((s) => s.id === a.scenario) as Scenario;
    const change = a.config ?? ((c: WorldConfig) => c);
    const variant: Scenario = {
      ...base,
      config: (p: Params) => change(base.config(p)),
      ...(base.counterfactual
        ? {
            counterfactual: (c: WorldConfig) =>
              change((base.counterfactual as (x: WorldConfig) => WorldConfig)(c)),
          }
        : {}),
    };
    const result = evaluateScenario(variant, { ...chosen, ...a.params }, seeds, cache);
    rows.push([
      a.label,
      result.results
        .map(
          (c) =>
            `${c.criterion.id} ${c.criterion.kind === "report" ? "" : c.pass ? "pass " : "FAIL "}${fmt(c.metric)}`,
        )
        .join(", "),
    ]);
  }
  console.log(table(rows));
}

interface Args {
  seed: number;
  reps: number;
  detailReps: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { seed: 1, reps: 3, detailReps: 5 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = Number(argv[i + 1]);
    const key = { "--seed": "seed", "--reps": "reps", "--detail-reps": "detailReps" }[arg ?? ""];
    if (key && Number.isInteger(next) && next > 0) {
      out[key as keyof Args] = next;
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
    `judge-weight r9 simulation: sweep seeds ${seeds.join(", ")}; detail seeds ${detailSeeds.join(", ")}`,
  );
  const cache: WorldCache = new Map();
  const evaluated = CURVES.map((curve) => evaluateCurve(curve, seeds, cache));
  const passable = new Set(
    evaluated.flatMap((e) =>
      e.points.flatMap((pt) =>
        flat(pt.results)
          .filter((c) => gated(c) && c.pass)
          .map((c) => c.criterion.id),
      ),
    ),
  );
  const sweeps = evaluated.map((e) => rankCurve(e, passable));
  printSweep(sweeps, passable);

  const all = [...SCENARIOS, S6_WATCH_OFF];
  const detail = new Map<Curve, ScenarioResult[]>(
    sweeps.map((s) => [
      s.curve,
      all.map((sc) => evaluateScenario(sc, s.chosen.params, detailSeeds, cache)),
    ]),
  );
  printPerCurve(detail);
  const best = recommend(sweeps, detail);
  const chosen = best.chosen.params;
  console.log(
    `\nRecommended: ${best.curve} (${describe(chosen, best.axes)}), robust share ${fmt(best.robust, 2)} of ${best.neighbours} neighbours`,
  );
  const show = Object.entries(chosen)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  console.log(`params: ${show}`);
  const results = detail.get(best.curve) ?? [];
  printScenarioDetail(results, chosen);
  printWatch(results);
  const scaled = all.map((sc) =>
    evaluateScenario(sc, { ...chosen, volumeV: SCALE_V }, detailSeeds, cache),
  );
  printTies(results, scaled, chosen);
  printOneAtATime(chosen, detailSeeds, cache);
  printAblations(chosen, detailSeeds, cache);
}
