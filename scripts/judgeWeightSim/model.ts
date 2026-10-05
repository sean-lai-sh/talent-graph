/**
 * The r8 judge-weight maths (docs/issues/28-judge-band-crossing.md §3), as
 * pure functions over plain numbers. No engine types: substance and selection
 * are synthetic numbers on Jev's [0, 1]-ish scale, and time is in days.
 *
 * Every formula of §3.1–§3.8 lives here; `sim.ts` sequences them and runs the
 * anti-cohort watch (§3.11).
 */

export type Recognition = "not_yet" | "soon" | "yes" | "not_sure";
export type Decision = "admit" | "deny";

export interface Params {
  /** §3.1 starting weight; chosen, not swept. */
  mu0: number;
  /** §3.1 ω = w^γ; chosen, not swept. */
  gamma: number;
  /** §3.1 soft cap: logit w = logit μ0 + T·tanh(Σ/T). */
  T: number;
  /** §3.1 clamp for p̂⁰ before logit. */
  eps: number;
  /** §3.2 position schedule share(k) = max(φ, 1/k^α). */
  alpha: number;
  phi: number;
  /** §3.2 credential gap c = clip(1 + β_g·gap, c_min, c_max); gap ≥ g0 makes a contrarian bet. */
  betaG: number;
  cMin: number;
  cMax: number;
  g0: number;
  /** §3.2 recognition answer stakes. "Not sure" is always 1. */
  b: { not_yet: number; soon: number; yes: number };
  /** §3.4 settlement stake for an admitted referral: 1 + (β − 1)·ρ. */
  beta: number;
  /** §3.3 decision date offset, §3.5 timing guard and arrival slack, in days. */
  D: number;
  G: number;
  S: number;
  /** §3.5 checkpoints in days (12 and 24 months). */
  horizon12: number;
  horizon24: number;
  /** §3.5 floor for thin starting (and later) scores. */
  sFloor: number;
  /** §3.6 dead band in spread units. */
  h: number;
  /** §3.3 admission scale and cap. */
  kappaA: number;
  LA: number;
  /** §3.8 movement scale; §3.4 per-referral backstop. */
  kappa: number;
  LM: number;
  /** §3.8 gate. */
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
  /** §3.6 fit versions and §3.11 watch both run on this cadence (a quarter), in days. */
  quarter: number;
  /** §3.11 checks per quarter. */
  B: number;
  /** §3.11 a watch finding counts as "rose" past this many spreads above normal. */
  watchRiseZ: number;
  /** §3.11 days a candidate can stay on the watch. */
  watchMaxDays: number;
  /** §3.11 flat checks in a row that take a candidate off the watch (r8: 2). */
  watchFlatExit: number;
  /**
   * §3.6 what the dead band is centred on. "median" is r8. "neutral" is not in
   * the spec: the centre at which the fitted residuals' d averages exactly 0,
   * used only to attribute the drift the median leaves on skewed movement.
   */
  centre: "median" | "neutral";
}

/** μ0, γ are the spec's; the rest are r8's "e.g." values or the r7 harness's chosen ones. */
export const R8_DEFAULTS: Params = {
  mu0: 0.3,
  gamma: 2,
  T: 3,
  eps: 0.01,
  alpha: 0.75,
  phi: 0.2,
  betaG: 3,
  cMin: 0.5,
  cMax: 1.5,
  g0: 0.05,
  b: { not_yet: 1.2, soon: 1.1, yes: 0.8 },
  beta: 1.25,
  D: 60,
  G: 30,
  S: 30,
  horizon12: 365,
  horizon24: 730,
  sFloor: 0.2,
  h: 0.3,
  kappaA: 0.25,
  LA: 0.75,
  kappa: 0.5,
  LM: 3,
  M: 20,
  sigmaMin: 0.03,
  N: 5,
  lambdaF: 2,
  eta: 0.3,
  tau: 4,
  lambda: 3,
  observationWindow: 180,
  topN: 3,
  quarter: 90,
  B: 20,
  watchRiseZ: 1,
  watchMaxDays: 1080,
  watchFlatExit: 2,
  centre: "median",
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
  /** False for referrals that take no position from others (recused, self, duplicate). */
  eligible: boolean;
}

/**
 * §3.2: rank eligible referrals by day, one position per distinct judge at its
 * earliest referral; same-day ties share the average of their positions.
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

/** q_uv = share(k) · c_uv · b_uv. */
export function referralWeight(k: number, gap: number, answer: Recognition, p: Params): number {
  return positionShare(k, p) * credentialStake(gap, p) * recognitionStake(answer, p);
}

/** §3.2: "Not yet" or "Soon", or substance ahead of credentials by g0. */
export function isContrarian(answer: Recognition, gap: number, p: Params): boolean {
  return answer === "not_yet" || answer === "soon" || gap >= p.g0;
}

// §3.3 admission ---------------------------------------------------------------

/** ρ for an admission; a denial's ρ is 0 whatever the signal shares were. */
export function reliance(decision: Decision, full: number, withoutJudge: number): number {
  if (decision === "deny" || full <= 0) return 0;
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

/** ψ(d) = sign(d)·ln(1 + |d|). */
export const compress = (d: number): number => Math.sign(d) * Math.log1p(Math.abs(d));

export function movementCredit(q: number, stake: number, d: number, p: Params): number {
  return clip(q * stake * compress(d), -p.LM, p.LM);
}

// §3.5 snapshots ---------------------------------------------------------------

/**
 * How evidence reaches a snapshot. `submitted`: the candidate's own, at
 * `availableAt`. `public`: found by the standard check from `availableAt` on.
 * `deep`: only a committee check finds it.
 */
export type Channel = "submitted" | "public" | "deep";

export interface EvidenceItem {
  id: string;
  kind: "output" | "selection";
  datedAt: number;
  availableAt: number;
  channel: Channel;
  /** Claimed value, including any exaggeration. */
  value: number;
  /** How much of `value` is exaggeration; a committee flag removes it. */
  inflation: number;
  /** When a committee flag lands on this claim, if ever. */
  flaggedAt: number | null;
}

export interface SnapshotWindow {
  evidenceCutoff: number;
  asOf: number;
  /** Pre-referral evidence (dated ≤ datedAtMost) is taken as of a later correction time. Flags stay as of `asOf`. */
  correction?: { datedAtMost: number; asOf: number };
  /** "standard": submissions and the standard check; "all" adds committee-found evidence. */
  scope: "standard" | "all";
}

export interface Snapshot {
  /** Floored at s_floor, so never missing. */
  substance: number;
  /** Fewer than topN output claims: marked thin, still scored. */
  thin: boolean;
  /** Mean of the top-N selection values; 0 with none, as Jev's rollup does. */
  selection: number;
  hash: string;
}

/**
 * s0, optionally as corrected on `correctedAsOf`: the correction only lets in
 * pre-referral evidence that arrived late. Flags are still read as of s0's own
 * compute time, so a correction never re-prices the rest of the snapshot.
 */
export function s0Window(t: number, p: Params, correctedAsOf?: number): SnapshotWindow {
  const asOf = t + p.G + p.S;
  return {
    evidenceCutoff: t + p.G,
    asOf,
    scope: "standard",
    ...(correctedAsOf !== undefined && correctedAsOf > asOf
      ? { correction: { datedAtMost: t + p.G, asOf: correctedAsOf } }
      : {}),
  };
}

export function checkpointWindow(
  t: number,
  horizon: number,
  p: Params,
  correctedAsOf?: number,
): SnapshotWindow {
  const asOf = t + horizon + p.S;
  return {
    evidenceCutoff: t + horizon,
    asOf,
    scope: "standard",
    ...(correctedAsOf !== undefined && correctedAsOf > asOf
      ? { correction: { datedAtMost: t + p.G, asOf: correctedAsOf } }
      : {}),
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
  if (item.datedAt > w.evidenceCutoff) return false;
  if (w.scope === "standard" && item.channel === "deep") return false;
  const late = w.correction;
  const asOf = late && item.datedAt <= late.datedAtMost ? late.asOf : w.asOf;
  return item.availableAt <= asOf;
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
    const flagged = item.flaggedAt !== null && item.flaggedAt <= w.asOf;
    const value = flagged ? item.value - item.inflation : item.value;
    (item.kind === "output" ? output : selection).push(value);
  }
  return {
    substance: Math.max(topMean(output, p.topN) ?? p.sFloor, p.sFloor),
    thin: output.length < p.topN,
    selection: topMean(selection, p.topN) ?? 0,
    hash: hashIds(ids),
  };
}

// §3.6 frozen fit versions -----------------------------------------------------

export interface Line {
  a: number;
  b: number;
}

export interface FitPoint {
  x: number;
  y: number;
}

/** Ordinary least squares; flat at the mean (or 0 with no points) when x has no spread. */
export function fitLine(points: readonly FitPoint[]): Line {
  const n = points.length;
  if (n === 0) return { a: 0, b: 0 };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const pt of points) {
    sx += pt.x;
    sy += pt.y;
    sxx += pt.x * pt.x;
    sxy += pt.x * pt.y;
  }
  const varX = sxx - (sx * sx) / n;
  if (n < 2 || varX <= 1e-12) return { a: sy / n, b: 0 };
  const b = (sxy - (sx * sy) / n) / varX;
  return { a: (sy - b * sx) / n, b };
}

export const evalLine = (line: Line, x: number): number => line.a + line.b * x;

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

/** Normal movement for one checkpoint: e(s), the centre r̃ (r8: the median residual) and the spread σ. */
export interface MovementNorm {
  line: Line;
  median: number;
  spread: number;
}

export const deadBand = (z: number, h: number): number =>
  Math.sign(z) * Math.max(Math.abs(z) - h, 0);

/** The centre c at which mean(deadBand((r − c)/σ, h)) over the residuals is 0, by bisection. */
function neutralCentre(residuals: readonly number[], spread: number, h: number): number {
  let lo = Math.min(...residuals);
  let hi = Math.max(...residuals);
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const mean = residuals.reduce((s, r) => s + deadBand((r - mid) / spread, h), 0);
    if (mean > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function fitNorm(points: readonly FitPoint[], p: Params): MovementNorm {
  const line = fitLine(points);
  const residuals = points.map((pt) => pt.y - evalLine(line, pt.x));
  const sd = stdev(residuals);
  const spread = sd > 0 ? sd : 1;
  const centre =
    p.centre === "neutral" && residuals.length > 0
      ? neutralCentre(residuals, spread, p.h)
      : median(residuals);
  return { line, median: centre, spread };
}

/** §3.6: z = (r − r̃)/σ, then the dead band h in spread units. */
export function movementBeyondNormal(
  s0: number,
  sk: number,
  norm: MovementNorm,
  h: number,
): number {
  return deadBand((sk - s0 - evalLine(norm.line, s0) - norm.median) / norm.spread, h);
}

// §3.7 accuracy and fade -------------------------------------------------------

export interface AccuracyState {
  ebar: number | null;
  n: number;
}

export const NO_ACCURACY: AccuracyState = { ebar: null, n: 0 };

export function scoreAccuracy(
  state: AccuracyState,
  x: number,
  truth: number,
  p: Params,
): AccuracyState {
  const e = (x - truth) ** 2;
  return { ebar: state.ebar === null ? e : (1 - p.eta) * state.ebar + p.eta * e, n: state.n + 1 };
}

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
  return p.kappa * (1 - p.M / K);
}

export const judgeLabel = (scoredSignals: number, p: Params): "provisional" | "calibrated" =>
  scoredSignals >= p.N ? "calibrated" : "provisional";

// §3.1 the weight --------------------------------------------------------------

export interface JudgeTerms {
  /** Σ ℓᴬ over applied (not escrowed), unsettled referrals. */
  sumA: number;
  /** Σ ℓᴹ over settled referrals (the latest checkpoint each), before the ramp κ_m(t). */
  sumM: number;
  nSettled: number;
  accuracy: AccuracyState;
}

export const EMPTY_TERMS: JudgeTerms = { sumA: 0, sumM: 0, nSettled: 0, accuracy: NO_ACCURACY };

/** Σ_u before the soft cap. */
export function rawTotal(t: JudgeTerms, kappaM: number, p: Params): number {
  const accuracy = fadeShare(t.nSettled, p) * (logit(shrunkAccuracy(t.accuracy, p)) - logit(p.mu0));
  return t.sumA + accuracy + kappaM * t.sumM;
}

export function logitWeight(t: JudgeTerms, kappaM: number, p: Params): number {
  return logit(p.mu0) + p.T * Math.tanh(rawTotal(t, kappaM, p) / p.T);
}

export function weights(logitW: number, p: Params): { w: number; omega: number } {
  const w = sigmoid(logitW);
  return { w, omega: w ** p.gamma };
}

// §6 the per-event bound, by event kind ----------------------------------------

export type BoundedEvent =
  | "admission"
  | "correct"
  | "accuracy"
  | "settle12"
  | "settle24"
  | "ramp"
  | "release";

/**
 * Largest change one event of each kind can make to Σ, and so to logit w
 * (tanh is 1-Lipschitz), never more than 2T, the soft cap's whole range.
 * Accuracy: one update can move logit p̂⁰ across its clamp range.
 * Ramp: one step of κ_m shifts the settled sum, which only the soft cap bounds.
 */
export function perEventBound(kind: BoundedEvent, p: Params): number {
  const accuracySpan = logit(1 - p.eps) - logit(p.eps);
  const fadeStep = accuracySpan / (p.lambdaF + 1);
  const raw: Record<BoundedEvent, number> = {
    admission: p.LA,
    correct: 2 * Math.max(p.LA, p.kappa * p.LM),
    accuracy: accuracySpan,
    settle12: p.LA + p.kappa * p.LM + fadeStep,
    settle24: 2 * p.kappa * p.LM,
    ramp: Number.POSITIVE_INFINITY,
    release: 0,
  };
  return Math.min(raw[kind], 2 * p.T);
}
