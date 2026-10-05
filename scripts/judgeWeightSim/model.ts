/**
 * The r7 judge-weight maths (docs/issues/28-judge-band-crossing.md §3), as
 * pure functions over plain numbers. No engine types: substance and selection
 * are synthetic numbers on Jev's [0, 1]-ish scale, and time is in days.
 *
 * Every formula of §3.1–§3.8 lives here; `sim.ts` only sequences them.
 */

export type Recognition = "not_yet" | "soon" | "yes" | "not_sure";
export type Decision = "admit" | "deny";

export interface Params {
  /** §3.1 starting weight; chosen, not swept. */
  mu0: number;
  /** §3.1 ω = w^γ; chosen, not swept. */
  gamma: number;
  /** §3.1 clamp for p̂⁰ before logit. */
  eps: number;
  /** §3.2 position schedule share(k) = max(φ, 1/k^α). */
  alpha: number;
  phi: number;
  /** §3.2 credential gap c_v = clip(1 + β_g·gap, c_min, c_max). */
  betaG: number;
  cMin: number;
  cMax: number;
  /** §3.2 recognition answer stakes. "Not sure" is always 1. */
  b: { not_yet: number; soon: number; yes: number };
  /** §3.4 settlement stake for an admitted referral: 1 + (β − 1)·ρ. */
  beta: number;
  /** §3.3 decision date offset, §3.5 timing guard and arrival slack, in days. */
  D: number;
  G: number;
  S: number;
  /** §3.5 movement horizon in days (12 months). */
  horizon: number;
  /** §3.6 dead band in substance units. */
  h: number;
  /** §3.3 admission scale and cap. */
  kappaA: number;
  LA: number;
  /** §3.8 movement scale; §3.4 per-referral movement cap. */
  kappa: number;
  LM: number;
  /** §3.8 gate: club candidates with both snapshots, and minimum spread of starting scores. */
  M: number;
  sigmaMin: number;
  /** §3.8 label: scored signals before "calibrated". */
  N: number;
  /** §3.7 fade: π = λ_f / (λ_f + n_settled). */
  lambdaF: number;
  /** V2 accuracy (§2): EMA rate η, error scale τ, shrinkage λ, observation window. */
  eta: number;
  tau: number;
  lambda: number;
  observationWindow: number;
  /** Jev rollup: substance and selection are the mean of the top-N accepted claims. */
  topN: number;
}

/** μ0 and γ are the spec's; the rest are r7's "e.g." values where it gives one. */
export const R7_DEFAULTS: Params = {
  mu0: 0.3,
  gamma: 2,
  eps: 0.01,
  alpha: 0.75,
  phi: 0.2,
  betaG: 3,
  cMin: 0.5,
  cMax: 1.5,
  b: { not_yet: 1.5, soon: 1.25, yes: 0.25 },
  beta: 2,
  D: 60,
  G: 30,
  S: 30,
  horizon: 365,
  h: 0.03,
  kappaA: 0.5,
  LA: 0.75,
  kappa: 10,
  LM: 0.15,
  M: 30,
  sigmaMin: 0.03,
  N: 5,
  lambdaF: 4,
  eta: 0.3,
  tau: 4,
  lambda: 3,
  observationWindow: 180,
  topN: 3,
};

export const clip = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const logit = (p: number): number => Math.log(p / (1 - p));
export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

// §3.2 position --------------------------------------------------------------

export function positionShare(k: number, p: Params): number {
  return Math.max(p.phi, 1 / k ** p.alpha);
}

export interface RankedReferral {
  id: string;
  judge: string;
  day: number;
  /** False for self-referrals, duplicates and recused referrals. */
  eligible: boolean;
}

/**
 * §3.2: rank eligible referrals by day, one position per distinct judge at its
 * earliest referral; same-day ties share the average of their positions.
 * Ineligible referrals get no position.
 */
export function rankPositions(referrals: readonly RankedReferral[]): Map<string, number> {
  const earliest = new Map<string, RankedReferral>();
  for (const r of referrals) {
    if (!r.eligible) continue;
    const prior = earliest.get(r.judge);
    if (!prior || r.day < prior.day || (r.day === prior.day && r.id < prior.id)) {
      earliest.set(r.judge, r);
    }
  }
  const ordered = [...earliest.values()].sort((x, y) => x.day - y.day);
  const out = new Map<string, number>();
  let i = 0;
  while (i < ordered.length) {
    let j = i;
    while (j + 1 < ordered.length && ordered[j + 1]?.day === ordered[i]?.day) j++;
    const average = (i + 1 + (j + 1)) / 2;
    for (let n = i; n <= j; n++) out.set((ordered[n] as RankedReferral).id, average);
    i = j + 1;
  }
  return out;
}

// §3.2 credential gap and recognition -----------------------------------------

export function credentialStake(gap: number, p: Params): number {
  return clip(1 + p.betaG * gap, p.cMin, p.cMax);
}

export function recognitionStake(answer: Recognition, p: Params): number {
  return answer === "not_sure" ? 1 : p.b[answer];
}

/** q_uv = share(k) · c_v · b_uv; a referral with no position carries no stake. */
export function referralWeight(
  k: number | null,
  gap: number,
  answer: Recognition,
  p: Params,
): number {
  if (k === null) return 0;
  return positionShare(k, p) * credentialStake(gap, p) * recognitionStake(answer, p);
}

// §3.3 admission ---------------------------------------------------------------

export function reliance(full: number, withoutJudge: number): number {
  if (full <= 0) return 0;
  return clip((full - withoutJudge) / full, 0, 1);
}

export function admissionCredit(q: number, decision: Decision, rho: number, p: Params): number {
  const a = decision === "admit" ? 1 : -1;
  return clip(p.kappaA * q * a * (1 - rho), -p.LA, p.LA);
}

// §3.4 settlement --------------------------------------------------------------

export function settlementStake(admitted: boolean, rho: number, p: Params): number {
  return admitted ? 1 + (p.beta - 1) * rho : 1;
}

export function movementCredit(q: number, stake: number, d: number, p: Params): number {
  return clip(q * stake * d, -p.LM, p.LM);
}

// §3.5 snapshots ---------------------------------------------------------------

export interface EvidenceItem {
  id: string;
  kind: "output" | "selection";
  /** When the evidence became observable. */
  datedAt: number;
  /** When it reached us. */
  ingestedAt: number;
  value: number;
}

export interface SnapshotWindow {
  evidenceCutoff: number;
  ingestionCutoff: number;
  /** Late pre-referral evidence (§3.5 "no manufactured movement"). */
  excludeDatedBefore?: { datedAtMost: number; ingestedAfter: number };
}

export interface Snapshot {
  storedAt: number;
  /** Mean of the top-N output values; null when there is no output evidence. */
  substance: number | null;
  /** Mean of the top-N selection values; 0 with none, as Jev's rollup does. */
  selection: number;
  hash: string;
}

export function s0Window(t: number, p: Params): SnapshotWindow {
  return { evidenceCutoff: t + p.G, ingestionCutoff: t + p.G + p.S };
}

export function s12Window(t: number, p: Params): SnapshotWindow {
  return {
    evidenceCutoff: t + p.horizon,
    ingestionCutoff: t + p.horizon + p.S,
    excludeDatedBefore: { datedAtMost: t + p.G, ingestedAfter: t + p.G + p.S },
  };
}

function topMean(values: number[], n: number): number | null {
  if (values.length === 0) return null;
  const top = values.sort((x, y) => y - x).slice(0, n);
  return top.reduce((s, v) => s + v, 0) / top.length;
}

/** FNV-1a over the included claim ids sorted by id, so arrival order cannot change it. */
function hashIds(ids: string[]): string {
  let h = 0x811c9dc5;
  for (const id of [...ids].sort()) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function includedIn(item: EvidenceItem, w: SnapshotWindow): boolean {
  if (item.datedAt > w.evidenceCutoff || item.ingestedAt > w.ingestionCutoff) return false;
  const late = w.excludeDatedBefore;
  return !(late && item.datedAt <= late.datedAtMost && item.ingestedAt > late.ingestedAfter);
}

export function takeSnapshot(
  items: readonly EvidenceItem[],
  w: SnapshotWindow,
  p: Params,
): Snapshot {
  const output: number[] = [];
  const selection: number[] = [];
  const ids: string[] = [];
  for (const item of items) {
    if (!includedIn(item, w)) continue;
    ids.push(item.id);
    (item.kind === "output" ? output : selection).push(item.value);
  }
  return {
    storedAt: w.ingestionCutoff,
    substance: topMean(output, p.topN),
    selection: topMean(selection, p.topN) ?? 0,
    hash: hashIds(ids),
  };
}

// §3.2 f and §3.6 e: pooled lines, leave-one-out ------------------------------

export interface Line {
  a: number;
  b: number;
  /** Number of points the line was fitted on: the frozen version a stored result records. */
  version: number;
}

export interface FitPoint {
  id: string;
  x: number;
  y: number;
}

/**
 * Ordinary least squares on every point except `leaveOut`. With fewer than
 * two points, or no spread in x, the line is flat at the mean (or 0 with no
 * points): the simplest reading of a fit the spec does not define below the gate.
 */
export function fitLineLeaveOneOut(points: readonly FitPoint[], leaveOut: string): Line {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const pt of points) {
    if (pt.id === leaveOut) continue;
    n++;
    sx += pt.x;
    sy += pt.y;
    sxx += pt.x * pt.x;
    sxy += pt.x * pt.y;
  }
  if (n === 0) return { a: 0, b: 0, version: 0 };
  const varX = sxx - (sx * sx) / n;
  if (n < 2 || varX <= 1e-12) return { a: sy / n, b: 0, version: n };
  const b = (sxy - (sx * sy) / n) / varX;
  return { a: (sy - b * sx) / n, b, version: n };
}

export const evalLine = (line: Line, x: number): number => line.a + line.b * x;

// §3.6 movement ---------------------------------------------------------------

export function deadBand(r: number, h: number): number {
  return Math.sign(r) * Math.max(Math.abs(r) - h, 0);
}

export function movementBeyondNormal(s0: number, s12: number, e: Line, h: number): number {
  return deadBand(s12 - s0 - evalLine(e, s0), h);
}

// §3.7 accuracy and fade -------------------------------------------------------

export interface AccuracyState {
  /** EMA of squared error; null before the first scored referral. */
  ebar: number | null;
  n: number;
}

export const NO_ACCURACY: AccuracyState = { ebar: null, n: 0 };

/** V2's chronological EMA update with E = (x − truth)². */
export function scoreAccuracy(
  state: AccuracyState,
  x: number,
  truth: number,
  p: Params,
): AccuracyState {
  const e = (x - truth) ** 2;
  return { ebar: state.ebar === null ? e : (1 - p.eta) * state.ebar + p.eta * e, n: state.n + 1 };
}

/** p̂⁰: V2 accuracy shrunk toward μ0 instead of 1, clamped to [ε, 1 − ε]. */
export function shrunkAccuracy(state: AccuracyState, p: Params): number {
  if (state.ebar === null) return p.mu0;
  const raw = Math.exp(-p.tau * state.ebar);
  const shrunk = (state.n * raw + p.lambda * p.mu0) / (state.n + p.lambda);
  return clip(shrunk, p.eps, 1 - p.eps);
}

export function fadeShare(nSettled: number, p: Params): number {
  return p.lambdaF / (p.lambdaF + nSettled);
}

// §3.8 gate, ramp, label -------------------------------------------------------

export function movementScale(K: number, spread: number, p: Params): number {
  if (K < p.M || spread < p.sigmaMin) return 0;
  return (p.kappa * (K - p.M)) / (K - p.M + p.M);
}

export const judgeLabel = (scoredSignals: number, p: Params): "provisional" | "calibrated" =>
  scoredSignals >= p.N ? "calibrated" : "provisional";

// §3.1 the weight --------------------------------------------------------------

export interface JudgeTerms {
  /** Σ ℓᴬ over credited, unsettled referrals. */
  sumA: number;
  /** Σ ℓᴹ over settled referrals, before the ramp κ_m(t). */
  sumM: number;
  nSettled: number;
  accuracy: AccuracyState;
}

export const EMPTY_TERMS: JudgeTerms = { sumA: 0, sumM: 0, nSettled: 0, accuracy: NO_ACCURACY };

export function logitWeight(t: JudgeTerms, kappaM: number, p: Params): number {
  const accuracy = fadeShare(t.nSettled, p) * (logit(shrunkAccuracy(t.accuracy, p)) - logit(p.mu0));
  return logit(p.mu0) + t.sumA + accuracy + kappaM * t.sumM;
}

export function weights(logitW: number, p: Params): { w: number; omega: number } {
  const w = sigmoid(logitW);
  return { w, omega: w ** p.gamma };
}

/**
 * The stated per-event bound (§6): settling one referral removes its ℓᴬ
 * (≤ Lᴬ), adds κ_m·ℓᴹ (≤ κ·Lᴹ) and shifts the fade by at most
 * 1/(λ_f + 1) of the largest accuracy term.
 */
export function perEventBound(p: Params): number {
  const accuracySpan = Math.max(logit(1 - p.eps) - logit(p.mu0), logit(p.mu0) - logit(p.eps));
  return p.LA + p.kappa * p.LM + accuracySpan / (p.lambdaF + 1);
}
