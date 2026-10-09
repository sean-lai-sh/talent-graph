/**
 * Checks 2–4. Each one looks at the checkout and skips until the
 * functions and fields from its PR are present. Nothing here reads an env flag.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Referral } from "../../../../src/domain/types.ts";
import {
  admissionPresent,
  type CheckResult,
  referralSignalPresent,
  SKIP_ADMISSION,
  SKIP_REFERRAL_SIGNAL,
  SKIP_SNAPSHOTS,
  snapshotsPresent,
} from "./detect.ts";

type Loose = Record<string, unknown>;

async function load(root: string, rel: string): Promise<Loose> {
  return (await import(join(root, rel))) as Loose;
}

function pass(id: CheckResult["id"], detail: string): CheckResult {
  return { id, status: "pass", detail };
}

function fail(id: CheckResult["id"], detail: string): CheckResult {
  return { id, status: "fail", detail };
}

function skip(id: CheckResult["id"], detail: string): CheckResult {
  return { id, status: "skipped", detail };
}

export async function checkAdmission(root: string): Promise<CheckResult> {
  if (!admissionPresent(root)) return skip("admission-credit", SKIP_ADMISSION);
  const engine = await load(root, "apps/club/lib/engine.ts");
  const observations = await load(root, "apps/club/lib/engine/admission.ts");
  const admission = await load(root, "src/judges/admission.ts");
  const serialize = await load(root, "apps/club/lib/serialize.ts");
  const registry = await load(root, "src/models/registry.ts");

  const addPerson = engine.addPerson as (state: Loose, input: Loose) => { state: Loose };
  const addReferral = engine.addReferral as (state: Loose, input: Loose) => { state: Loose };
  const decide = engine.decide as (
    state: Loose,
    personId: string,
    decision: string,
    deps: undefined,
    decider: { decidedBy: string },
  ) => { state: Loose };
  const emptyState = engine.emptyState as (now?: string) => Loose;
  const clubToReferral = serialize.clubToReferral as (row: Loose) => Referral;
  const admissionObservations = observations.admissionObservations as (state: Loose) => unknown;
  const computeAdmission = admission.computeAdmission as (
    referrals: Referral[],
    obs: unknown,
    spec: unknown,
    now: Date,
  ) => { terms: { judgeId: string }[] };
  const referralPositions = admission.referralPositions as (
    referrals: Referral[],
    spec: unknown,
  ) => Map<string, { position: number; judgeId: string }>;

  const spec = Object.values(registry).find(
    (value) => !!value && typeof value === "object" && "admission" in value && "version" in value,
  ) as { admission: unknown; version: string } | undefined;
  if (!spec?.admission) return fail("admission-credit", "admission spec is not registered");

  let state = emptyState("2026-06-01T00:00:00.000Z");
  state = addPerson(state, { name: "Ada Judge", status: "member" }).state;
  const people = () => state.people as { id: string }[];
  const adaId = people().at(-1)?.id;
  state = addPerson(state, { name: "Bo Judge", status: "member" }).state;
  const boId = people().at(-1)?.id;
  state = addPerson(state, { name: "Candidate Poe" }).state;
  const candId = people().at(-1)?.id;
  if (!adaId || !boId || !candId) return fail("admission-credit", "could not add the three people");

  state = { ...state, now: "2026-06-02T00:00:00.000Z" };
  state = addReferral(state, {
    referrerId: adaId,
    candidateId: candId,
    conviction: 5,
    confidence: 5,
    relationshipDepth: 4,
    evidenceType: "firsthand_work",
    evidenceText: "Shipped the signup flow.",
  }).state;
  state = { ...state, now: "2026-06-03T00:00:00.000Z" };
  state = addReferral(state, {
    referrerId: boId,
    candidateId: candId,
    conviction: 4,
    confidence: 4,
    relationshipDepth: 4,
    evidenceType: "firsthand_work",
    evidenceText: "Reviewed the same work.",
  }).state;
  state = { ...state, now: "2026-06-10T00:00:00.000Z" };
  const decided = decide(state, candId, "admit", undefined, { decidedBy: adaId });
  const snapshots = (decided.state.snapshots ?? []) as {
    decidedBy?: string;
    signalWithout?: { referrerId: string }[];
  }[];
  const snap = snapshots[0];
  if (!snap) return fail("admission-credit", "decision wrote no snapshot");
  if (snap.decidedBy !== adaId) {
    return fail("admission-credit", `snapshot decidedBy is ${String(snap.decidedBy)}`);
  }
  const without = new Set((snap.signalWithout ?? []).map((row) => row.referrerId));
  if (!without.has(adaId) || !without.has(boId)) {
    return fail("admission-credit", "snapshot is missing a leave-one-judge-out signal");
  }
  const referrals = ((decided.state.referrals ?? []) as Loose[]).map(clubToReferral);
  const positions = referralPositions(referrals, spec.admission);
  const judges = new Set([...positions.values()].map((row) => row.judgeId));
  if (!judges.has(adaId) || !judges.has(boId)) {
    return fail("admission-credit", "a referrer is missing a position");
  }
  for (const row of positions.values()) {
    if (!Number.isFinite(row.position)) return fail("admission-credit", "position is not finite");
  }
  const result = computeAdmission(
    referrals,
    admissionObservations(decided.state),
    spec.admission,
    new Date(String(decided.state.now)),
  );
  if (result.terms.some((term) => term.judgeId === adaId)) {
    return fail("admission-credit", "the deciding judge received admission credit");
  }
  return pass("admission-credit", "decidedBy, positions, leave-one-out; decider has no credit");
}

function convex(root: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const bin = join(root, "apps/club/node_modules/.bin/convex");
  const result = spawnSync(bin, args, {
    cwd: join(root, "apps/club"),
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export async function checkSnapshots(root: string): Promise<CheckResult> {
  if (!snapshotsPresent(root)) return skip("snapshots", SKIP_SNAPSHOTS);
  const mod = await load(root, "apps/club/lib/longitudinal/evidenceSnapshots.ts");
  const planSnapshot = mod.planSnapshot as (input: Loose) => { thin?: boolean } | null;
  const intakeAt = new Date("2026-01-01T00:00:00.000Z");
  const now = new Date("2026-04-01T00:00:00.000Z");
  const base = {
    candidateId: "ex-app-ash",
    kind: "s0",
    intakeAt,
    now,
    claims: [],
    records: [],
    resumeKeys: new Set<string>(),
    existing: [] as unknown[],
    classYear: null,
    newId: () => "snap-s0-1",
  };
  const first = planSnapshot(base);
  if (first?.thin !== true) {
    return fail("snapshots", "starting snapshot missing or not thin");
  }
  const second = planSnapshot({
    ...base,
    existing: [first],
    newId: () => "snap-s0-2",
  });
  if (second !== null)
    return fail("snapshots", "planning the same snapshot twice wrote another row");

  const evidence = readFileSync(join(root, "apps/club/convex/evidence.ts"), "utf8");
  const table = evidence.match(/\.query\("(evidence\w+)"\)/)?.[1] ?? "evidenceSnapshots";
  const firstDaily = convex(root, ["run", "evidence:daily", "{}"]);
  if (firstDaily.status !== 0) {
    return fail("snapshots", `evidence:daily failed: ${firstDaily.stderr.slice(0, 240)}`);
  }
  const before = convex(root, ["data", table]);
  const secondDaily = convex(root, ["run", "evidence:daily", "{}"]);
  if (secondDaily.status !== 0) {
    return fail("snapshots", `second evidence:daily failed: ${secondDaily.stderr.slice(0, 240)}`);
  }
  const after = convex(root, ["data", table]);
  if (before.status !== 0 || after.status !== 0) {
    return fail("snapshots", `could not read ${table}`);
  }
  if (before.stdout !== after.stdout) {
    return fail("snapshots", "running the snapshot cron twice changed stored rows");
  }
  return pass("snapshots", `s0 thin; ${table} unchanged across two cron runs`);
}

export async function checkReferralSignal(root: string): Promise<CheckResult> {
  if (!referralSignalPresent(root)) return skip("referral-signal", SKIP_REFERRAL_SIGNAL);
  const registry = await load(root, "src/models/registry.ts");
  const reliability = await load(root, "src/judges/reliability.ts");
  const scoring = await load(root, "src/scoring/referralSignal.ts");
  const spec = registry.REFERRAL_SIGNAL_V0_2_0;
  const judgeSpec = registry.JUDGE_RELIABILITY_V4_0_0;
  const pseudoWeight = reliability.judgePseudoWeight as (spec: unknown) => number;
  const compute = scoring.computeReferralSignal as (
    id: string,
    referrals: Referral[],
    opts: Loose,
  ) => { s: number };
  const c0 = pseudoWeight(judgeSpec);
  const when = new Date("2026-01-01T00:00:00.000Z");
  const strong: Referral = {
    id: "r-proven",
    referrerId: "proven",
    candidateId: "cand",
    conviction: 5,
    confidence: 5,
    relationshipDepth: 5,
    evidenceType: "firsthand_work",
    evidenceText: "Shipped it.",
    createdAt: when,
    updatedAt: when,
  };
  const added: Referral = { ...strong, id: "r-new", referrerId: "newcomer" };
  const opts = {
    spec,
    pseudoWeight: c0,
  };
  const before = compute("cand", [strong], {
    ...opts,
    judgeReliability: new Map([["proven", 0.81]]),
  }).s;
  const after = compute("cand", [strong, added], {
    ...opts,
    judgeReliability: new Map([
      ["proven", 0.81],
      ["newcomer", 0.09],
    ]),
  }).s;
  if (after < before - 1e-12) {
    return fail("referral-signal", `signal fell from ${before} to ${after}`);
  }
  return pass("referral-signal", `signal ${before} -> ${after}`);
}
