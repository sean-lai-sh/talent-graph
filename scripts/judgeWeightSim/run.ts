#!/usr/bin/env bun
/**
 * bun run sim:judges [-- --seed <n>] [--reps <n>] [--detail-reps <n>] [--curve G1|G2|G3]
 *
 * Delivery step 0 of the r10 judge-weight spec (docs/issues/28), invite-only:
 * runs S1–S6 at the r10 set on the broad pool and on a pre-selected pool,
 * sweeps κ_a, κ, h and M around that set for both pools and reports the
 * robust passing share, checks whether the noise filter h is too wide for a
 * pre-selected pool, and runs realistic small clubs to see how long the
 * movement gate stays shut and what admission and accuracy recover before it
 * opens. `--curve` swaps in G1 or G2 for comparison; G3 is the spec curve.
 *
 * The sweep uses `--reps` seeds (3); everything else uses `--detail-reps`
 * (5). Deterministic: no clock, network or environment read, so the same
 * arguments print the same bytes.
 */

import { type Curve, type Params, R10_DEFAULTS } from "./model.ts";
import {
  atCeiling,
  type CriterionResult,
  evaluateScenario,
  PRESELECT_SHARE,
  preselected,
  SCENARIOS,
  type Scenario,
  type ScenarioResult,
  SMALL_CLUBS,
  skillOrder,
  skillOrderAt,
  smallClubConfig,
  type WorldCache,
} from "./scenarios.ts";
import { latestSettlement, type RunResult, simulate } from "./sim.ts";
import { generateWorld, MONTH, type World } from "./world.ts";

/** The sweep around the r10 set: every axis is centred on R10_DEFAULTS. */
const AXES: Record<string, number[]> = {
  kappaA: [0.15, 0.25, 0.35],
  kappa: [0.2, 0.3, 0.45],
  h: [0.1, 0.25, 0.5],
  M: [10, 20, 30],
};

interface GridPoint {
  at: number[];
  params: Params;
}

function gridAround(base: Params): GridPoint[] {
  let points: GridPoint[] = [{ at: [], params: base }];
  for (const [axis, values] of Object.entries(AXES)) {
    points = points.flatMap((pt) =>
      values.map((v, i) => ({ at: [...pt.at, i], params: { ...pt.params, [axis]: v } })),
    );
  }
  return points;
}

const flat = (results: ScenarioResult[]): CriterionResult[] => results.flatMap((r) => r.results);
const gated = (c: CriterionResult) => c.criterion.kind !== "report";
const fmt = (x: number, digits = 3): string =>
  Number.isNaN(x) ? "n/a" : Number.isFinite(x) ? x.toFixed(digits) : String(x);
const mean = (xs: number[]): number =>
  xs.length === 0 ? Number.NaN : xs.reduce((s, x) => s + x, 0) / xs.length;

function table(rows: string[][]): string {
  const widths = (rows[0] ?? []).map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ")).join("\n");
}

const describe = (p: Params): string =>
  Object.keys(AXES)
    .map((k) => `${k}=${p[k as keyof Params] as number}`)
    .join(" ");

// --- results at the r10 set ---------------------------------------------------------

interface Pool {
  label: string;
  scenarios: Scenario[];
}

function printResults(pools: Pool[], results: Map<string, ScenarioResult[]>): void {
  console.log("\n== S1–S6 at the r10 set (detail seeds) ==\n");
  const first = results.get(pools[0]?.label ?? "") ?? [];
  const rows = [["criterion", "threshold", ...pools.map((p) => p.label)]];
  first.forEach((r, i) => {
    r.results.forEach((c, j) => {
      rows.push([
        c.criterion.id,
        c.criterion.threshold,
        ...pools.map((pool) => {
          const cr = results.get(pool.label)?.[i]?.results[j];
          if (!cr) return "";
          const verdict = cr.criterion.kind === "report" ? "info" : cr.pass ? "pass" : "FAIL";
          return `${fmt(cr.metric)} ${verdict}`;
        }),
      ]);
    });
  });
  console.log(table(rows));
  const ceilingRows = [["scenario", ...pools.map((p) => `${p.label}: judges at the ceiling`)]];
  first.forEach((r, i) => {
    ceilingRows.push([
      r.scenario.id,
      ...pools.map((pool) => {
        const res = results.get(pool.label)?.[i];
        const runs = res?.runs ?? [];
        return `${fmt(mean(runs.map((x) => atCeiling(x.run, R10_DEFAULTS))), 1)} of ${runs[0]?.run.judges.length ?? 0}`;
      }),
    ]);
  });
  console.log(`\nTop-of-scale ties with volume scaling on (tanh(Σ/T) ≥ 0.9):\n`);
  console.log(table(ceilingRows));
}

// --- the sweep and its robustness ---------------------------------------------------

interface Swept {
  pool: string;
  points: { point: GridPoint; results: ScenarioResult[] }[];
}

function sweep(pool: Pool, base: Params, seeds: number[], cache: WorldCache): Swept {
  const scenarios = pool.scenarios.filter((s) => s.sweep);
  return {
    pool: pool.label,
    points: gridAround(base).map((point) => ({
      point,
      // Only the criteria are kept per grid point; the runs would hold every referral.
      results: scenarios.map((s) => ({
        ...evaluateScenario(s, point.params, seeds, cache),
        runs: [],
      })),
    })),
  };
}

function printSweep(s: Swept): Params {
  const ids = flat(s.points[0]?.results ?? [])
    .filter(gated)
    .map((c) => c.criterion.id);
  const passes = (id: string, results: ScenarioResult[]) =>
    flat(results).find((c) => c.criterion.id === id)?.pass ?? false;
  const passable = new Set(ids.filter((id) => s.points.some((pt) => passes(id, pt.results))));
  const passAll = (results: ScenarioResult[]) => [...passable].every((id) => passes(id, results));
  const near = (a: GridPoint, b: GridPoint) =>
    a.at.every((v, i) => Math.abs(v - (b.at[i] ?? 0)) <= 1);
  const share = (pt: GridPoint) => {
    const hood = s.points.filter((x) => near(x.point, pt));
    return hood.filter((x) => passAll(x.results)).length / hood.length;
  };
  const centre = s.points.find((x) => x.point.at.every((v) => v === 1)) as Swept["points"][number];
  const margin = (results: ScenarioResult[]) =>
    Math.min(
      ...flat(results)
        .filter((c) => c.criterion.kind === "check" && passable.has(c.criterion.id))
        .map((c) => c.margin),
    );
  const best = [...s.points].sort(
    (a, b) =>
      Number(passAll(b.results)) - Number(passAll(a.results)) ||
      share(b.point) - share(a.point) ||
      margin(b.results) - margin(a.results),
  )[0] as Swept["points"][number];

  console.log(`\n-- ${s.pool}: ${s.points.length} sets --`);
  const never = ids.filter((id) => !passable.has(id));
  console.log(
    `Fail at every set (design findings, left out of "pass everything"): ${never.join(", ") || "none"}`,
  );
  console.log(
    `Pass everything: ${s.points.filter((x) => passAll(x.results)).length}/${s.points.length}`,
  );
  console.log(
    `r10 set (${describe(centre.point.params)}): passes everything ${passAll(centre.results)}; robust share ${fmt(share(centre.point), 2)} of its ${s.points.filter((x) => near(x.point, centre.point)).length} neighbours`,
  );
  console.log(
    `Best set (${describe(best.point.params)}): robust share ${fmt(share(best.point), 2)}, min margin ${fmt(margin(best.results), 2)}`,
  );
  const rows = [["axis", ...[0, 1, 2].map((i) => `value ${i + 1}`)]];
  for (const [k, axis] of Object.keys(AXES).entries()) {
    rows.push([
      axis,
      ...(AXES[axis] ?? []).map((v, i) => {
        const subset = s.points.filter((x) => x.point.at[k] === i);
        return `${v}: ${subset.filter((x) => passAll(x.results)).length}/${subset.length}`;
      }),
    ]);
  }
  console.log(table(rows));
  const failing = [["criterion", "passes in"]];
  for (const id of ids) {
    const n = s.points.filter((pt) => passes(id, pt.results)).length;
    if (n < s.points.length) failing.push([id, `${n}/${s.points.length}`]);
  }
  console.log(`\nCriteria that fail somewhere in the grid:\n${table(failing)}`);
  return best.point.params;
}

// --- is h too wide for a narrower pool? -----------------------------------------------

function printNoiseFilter(pools: Pool[], results: Map<string, ScenarioResult[]>, p: Params): void {
  console.log(
    "\n== Noise filter: is h too wide for the pre-selected pool? (S1, detail seeds) ==\n",
  );
  const rows = [
    [
      "pool",
      "level sd of pool",
      "12-month residual spread σ",
      "|z − c| < h (inside the soft band)",
      "mean |d| per settled referral",
    ],
  ];
  for (const pool of pools) {
    const s1 = results.get(pool.label)?.[0];
    const runs = s1?.runs ?? [];
    const sigma = runs.map((x) => lastSpread(x.run));
    const zs = runs.flatMap((x) =>
      x.run.referrals.flatMap((r) => (r.settlements[0] ? [r.settlements[0].z] : [])),
    );
    const ds = runs.flatMap((x) =>
      x.run.referrals.flatMap((r) => {
        const s = latestSettlement(r);
        return s ? [Math.abs(s.d)] : [];
      }),
    );
    rows.push([
      pool.label,
      fmt(mean(runs.map((x) => x.world.population.sdA))),
      fmt(mean(sigma)),
      `${fmt((100 * zs.filter((z) => Math.abs(z) < p.h).length) / Math.max(1, zs.length), 0)}% of ${zs.length}`,
      fmt(mean(ds)),
    ]);
  }
  console.log(table(rows));
}

/** The 12-month residual spread σ of the last fit version a run released. */
function lastSpread(run: RunResult): number {
  const pts = run.versions.at(-1)?.e[0] ?? [];
  if (pts.length < 3) return Number.NaN;
  const n = pts.length;
  const mx = pts.reduce((s, pt) => s + pt.x, 0) / n;
  const my = pts.reduce((s, pt) => s + pt.y, 0) / n;
  const sxx = pts.reduce((s, pt) => s + (pt.x - mx) ** 2, 0);
  const b = sxx > 0 ? pts.reduce((s, pt) => s + (pt.x - mx) * (pt.y - my), 0) / sxx : 0;
  const res = pts.map((pt) => pt.y - my - b * (pt.x - mx));
  return Math.sqrt(res.reduce((s, r) => s + r * r, 0) / (n - 1));
}

// --- small clubs ----------------------------------------------------------------------

function printSmallClubs(p: Params, seeds: number[], cache: WorldCache): void {
  console.log("\n== Realistic small clubs (36 months, detail seeds) ==\n");
  const rows = [
    [
      "pool",
      "candidates",
      "judges",
      "M",
      "K at month 36",
      "gate opens (month)",
      "Spearman before the gate (month)",
      "Spearman at 12",
      "Spearman at 36",
    ],
  ];
  for (const preselect of [null, PRESELECT_SHARE]) {
    for (const club of SMALL_CLUBS) {
      for (const M of [20, 10]) {
        const params = { ...p, M };
        const runs = seeds.map((seed) => {
          const config = smallClubConfig(club, preselect);
          const key = `${JSON.stringify(config)}#${seed}`;
          let world: World | undefined = cache.get(key);
          if (!world) {
            world = generateWorld(config, seed);
            cache.set(key, world);
          }
          return { world, run: simulate(world, params) };
        });
        const opened = runs.map((x) =>
          x.run.gateOpenedDay === null ? null : Math.ceil((x.run.gateOpenedDay + 1) / MONTH),
        );
        const openMonths = opened.filter((m): m is number => m !== null);
        const before = runs.map((x, i) => {
          const month = Math.max(1, (opened[i] ?? 37) - 1);
          return { month, rho: skillOrderAt(x.run, x.world, Math.min(month, 36)) };
        });
        rows.push([
          preselect === null ? "broad" : "pre-selected",
          String(club.candidates),
          String(club.judges),
          String(M),
          fmt(mean(runs.map((x) => x.run.K)), 1),
          openMonths.length === 0
            ? "never"
            : `${fmt(mean(openMonths), 1)}${openMonths.length < runs.length ? ` (never in ${runs.length - openMonths.length}/${runs.length})` : ""}`,
          `${fmt(mean(before.map((b) => b.rho)), 2)} (${fmt(mean(before.map((b) => b.month)), 0)})`,
          fmt(mean(runs.map((x) => skillOrderAt(x.run, x.world, 12))), 2),
          fmt(mean(runs.map((x) => skillOrder(x.run, x.world))), 2),
        ]);
      }
    }
  }
  console.log(table(rows));
}

interface Args {
  seed: number;
  reps: number;
  detailReps: number;
  curve: Curve;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { seed: 1, reps: 3, detailReps: 5, curve: R10_DEFAULTS.curve };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    const next = Number(value);
    const key = { "--seed": "seed", "--reps": "reps", "--detail-reps": "detailReps" }[arg ?? ""];
    if (arg === "--curve" && (value === "G1" || value === "G2" || value === "G3")) {
      out.curve = value;
      i++;
    } else if (key && Number.isInteger(next) && next > 0) {
      (out as unknown as Record<string, number>)[key] = next;
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
  const base: Params = { ...R10_DEFAULTS, curve: args.curve };
  console.log(
    `judge-weight r10 simulation (invite-only): curve ${base.curve}; sweep seeds ${seeds.join(", ")}; detail seeds ${detailSeeds.join(", ")}`,
  );
  const show = Object.entries(base)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  console.log(`params: ${show}`);

  const cache: WorldCache = new Map();
  const pools: Pool[] = [
    { label: "broad", scenarios: [...SCENARIOS] },
    {
      label: `pre-selected (top ${PRESELECT_SHARE * 100}%)`,
      scenarios: SCENARIOS.map(preselected),
    },
  ];
  const results = new Map(
    pools.map((pool) => [
      pool.label,
      pool.scenarios.map((s) => evaluateScenario(s, base, detailSeeds, cache)),
    ]),
  );
  printResults(pools, results);
  printNoiseFilter(pools, results, base);

  console.log("\n== Sweep around the r10 set (κ_a, κ, h, M) ==");
  for (const pool of pools) printSweep(sweep(pool, base, seeds, cache));

  printSmallClubs(base, detailSeeds, cache);
}
