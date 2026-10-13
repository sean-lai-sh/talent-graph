/**
 * How c0 moves single-referral candidates against two-referral ones.
 *
 * The worlds are the PR #116 club pipeline (synthetic members and candidates,
 * base variant: spread inbound, hard no recorded, an advocate chooses among
 * 2). Seeds 1–5. Admission inside the harness is unchanged. Each candidate's
 * decision-time (ω, R) edges are re-scored with this repo's weight-normalised
 * Referral Signal, and c0 is judgePseudoWeight of judge_reliability@4.1.0
 * (μ0^γ = 0.09), not a literal.
 *
 * Reproduce the table:
 *   bun run scripts/judgeWeightSim/c0.ts
 */

import type { Referral } from "../../src/domain/types.ts";
import { judgePseudoWeight } from "../../src/judges/reliability.ts";
import { JUDGE_RELIABILITY_V4_1_0, REFERRAL_SIGNAL_V0_2_0 } from "../../src/models/registry.ts";
import { computeReferralSignal } from "../../src/scoring/referralSignal.ts";
import type { EdgeWeighting } from "../../src/scoring/weighting.ts";
import { R10_DEFAULTS } from "./model.ts";
import { runPipeline } from "./pipeline.ts";

const C0 = judgePseudoWeight(JUDGE_RELIABILITY_V4_1_0);
const T0 = new Date("2026-01-01T00:00:00.000Z");
const SEEDS = [1, 2, 3, 4, 5];
const PIPELINE_PARAMS = { ...R10_DEFAULTS, centredAdmission: true, yearInFits: true, D: 150 };

interface Edge {
  judge: string;
  omega: number;
  strength: number;
}

interface Scored {
  signal: number;
  usedCount: number;
}

function score(edges: readonly Edge[], c0: number): Scored {
  const referrals: Referral[] = edges.map((_, i) => ({
    id: `r${i}`,
    referrerId: `j${i}`,
    candidateId: "c",
    conviction: 5,
    confidence: 5,
    relationshipDepth: 5,
    evidenceType: "firsthand_work",
    evidenceText: "synthetic edge",
    createdAt: new Date(T0.getTime() + i * 1000),
    updatedAt: T0,
  }));
  const byId = new Map(referrals.map((referral, i) => [referral.id, edges[i] as Edge]));
  const weighting: EdgeWeighting = {
    kind: "sim",
    weighted: true,
    weigh(edge) {
      const row = byId.get(edge.referral.id) as Edge;
      return {
        contribution: row.omega * row.strength,
        eligible: row.omega > 0,
        factors: { reliability: row.omega, bias: 0, adjusted: row.strength },
      };
    },
  };
  const got = computeReferralSignal("c", referrals, {
    spec: REFERRAL_SIGNAL_V0_2_0,
    weighting,
    pseudoWeight: c0,
  });
  return { signal: got.signal, usedCount: got.usedCount };
}

interface Row {
  n: number;
  s0: number;
  sC0: number;
  sHalf: number;
  used: number;
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? Number.NaN : xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

function fmt(x: number): string {
  return Number.isFinite(x) ? x.toFixed(2) : "n/a";
}

function printGroup(label: string, rows: readonly Row[]): void {
  const delta = rows.map((row) => row.sC0 - row.s0);
  console.log(
    `${label.padEnd(18)} n=${String(rows.length).padStart(4)}  ` +
      `S(c0=0)=${fmt(mean(rows.map((row) => row.s0)))}  ` +
      `S(c0=${C0})=${fmt(mean(rows.map((row) => row.sC0)))}  ` +
      `S(c0=0.5)=${fmt(mean(rows.map((row) => row.sHalf)))}  ` +
      `delta=${fmt(mean(delta))} (${fmt(Math.min(...delta))} to ${fmt(Math.max(...delta))})  ` +
      `topK dropped ${rows.filter((row) => row.used < row.n).length}`,
  );
}

const rows: Row[] = [];
const histogram = new Map<number, number>();

for (const seed of SEEDS) {
  const result = runPipeline(
    { name: "club", seed, inboundMode: "spread", hardNo: "recorded", options: 2 },
    PIPELINE_PARAMS,
  );
  const latest = new Map<string, (typeof result.run.scored)[number]>();
  for (const snap of result.run.scored) latest.set(snap.candidate, snap);
  for (const snap of latest.values()) {
    const n = snap.edges.length;
    histogram.set(n, (histogram.get(n) ?? 0) + 1);
    if (n === 0) continue;
    const at0 = score(snap.edges, 0);
    const atC0 = score(snap.edges, C0);
    const atHalf = score(snap.edges, 0.5);
    rows.push({ n, s0: at0.signal, sC0: atC0.signal, sHalf: atHalf.signal, used: atC0.usedCount });
  }
}

console.log(`c0 = judgePseudoWeight(judge_reliability@4.1.0) = ${C0} (μ0^γ)`);
console.log(
  `seeds ${SEEDS.join(", ")}; referral counts ${[...histogram.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, count]) => `${n}:${count}`)
    .join(" ")}`,
);
printGroup(
  "single (n=1)",
  rows.filter((row) => row.n === 1),
);
printGroup(
  "two (n>=2)",
  rows.filter((row) => row.n >= 2),
);
printGroup("all scored", rows);
