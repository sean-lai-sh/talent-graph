/**
 * The r10 judge-weight maths (docs/issues/28-judge-band-crossing.md §3), as
 * pure functions over plain numbers. No engine types: substance and selection
 * are synthetic numbers on Jev's [0, 1]-ish scale, and time is in days.
 *
 * Every formula of §3.1–§3.8 lives here; `sim.ts` sequences them and runs the
 * anti-cohort watch (§3.11) and committee flags (§3.12).
 */

export type Recognition = "not_yet" | "soon" | "yes" | "not_sure";
export type Decision = "admit" | "deny";
/** §3.6 the three credit curves the simulation compares. */
export type Curve = "G1" | "G2" | "G3";

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
  /** §3.2 credential gap c = clip(1 + β_g·gap, c_min, c_max); gap ≥ g0 is pre-credential. */
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
  /** §3.4–§3.5 checkpoints in days: 12 months for every referral, 24 and 36 for pre-credential ones. */
  horizons: readonly number[];
  /** §3.5 floor for every snapshot. */
  sFloor: number;
  /** §3.6 credit curve, its softness h (spread units) and, for G3, its power p. */
  curve: Curve;
  h: number;
  p: number;
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
  /** §3.11 checks per quarter, half prioritised and half random, and the per-judge cap. */
  B: number;
  C: number;
  /** §3.11 a check finds "rose" past this many spreads above normal for the elapsed time. */
  watchRiseZ: number;
  /** §3.11 days a candidate stays eligible. */
  watchMaxDays: number;
  /** §3.1 volume scaling: a judge's movement sum is scaled by min(1, V / n_settled); 0 turns it off. */
  volumeV: number;
  /** Deferred in r10, off by default: the anti-cohort watch (§3.11). */
  watch: boolean;
  /** Deferred in r10, off by default: committee flags with two-person approval (§3.12). */
  flags: boolean;
}

/**
 * r10: G3 with p = 1.25 and the r9 harness's recommended set; volume scaling at
 * V = 10; recognition answers collected but every stake 1 until they can be
 * scored as predictions; the watch and committee flags deferred.
 */
export const R10_DEFAULTS: Params = {
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
  b: { not_yet: 1, soon: 1, yes: 1 },
  beta: 1.25,
  D: 60,
  G: 30,
  S: 30,
  horizons: [365, 730, 1095],
  sFloor: 0.3,
  curve: "G3",
  h: 0.25,
  p: 1.25,
  kappaA: 0.25,
  LA: 0.75,
  kappa: 0.3,
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
  C: 4,
  watchRiseZ: 1,
  watchMaxDays: 1080,
  volumeV: 10,
  watch: false,
  flags: false,
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

/** §3.2: measured by Jev alone; the recognition answer never enters. */
export const isPreCredential = (gap: number, p: Params): boolean => gap >= p.g0;

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

// §3.4 settlement and §3.6 the credit curve -------------------------------------

export function settlementStake(admitted: boolean, rho: number, p: Params): number {
  return admitted ? 1 + (p.beta - 1) * rho : 1;
}

/** §3.6 g: G1 hard band then log; G2 smooth and proportional; G3 smooth and steep. */
export function creditCurve(x: number, p: Params): number {
  const x2 = x * x;
  const fade = x2 + p.h * p.h > 0 ? x2 / (x2 + p.h * p.h) : 0;
  switch (p.curve) {
    case "G1":
      return Math.sign(x) * Math.log1p(Math.max(Math.abs(x) - p.h, 0));
    case "G2":
      return x * fade;
    case "G3":
      return Math.sign(x) * fade * Math.abs(x) ** p.p;
  }
}

export function movementCredit(q: number, stake: number, d: number, p: Params): number {
  return clip(q * stake * d, -p.LM, p.LM);
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
  /** How much of `value` is exaggeration: the latent truth an honest flag removes. */
  inflation: number;
}

/** An approved, unreversed committee flag (§3.12): lowers one claim by `amount` from `approvedAt`. */
export interface ActiveFlag {
  id: string;
  amount: number;
  approvedAt: number;
}

/** Every active flag on each claim; several on one claim lower it by the largest amount. */
export type FlagBook = ReadonlyMap<string, readonly ActiveFlag[]>;
export const NO_FLAGS: FlagBook = new Map();

export interface SnapshotWindow {
  evidenceCutoff: number;
  /** Compute time: availability cutoff, and the time flags are read as of. */
  asOf: number;
  /** Pre-referral evidence (dated ≤ datedAtMost) is taken as of a later correction time. */
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

const correctionFor = (t: number, p: Params, correctedAsOf: number | undefined, asOf: number) =>
  correctedAsOf !== undefined && correctedAsOf > asOf
    ? { correction: { datedAtMost: t + p.G, asOf: correctedAsOf } }
    : {};

/** s0, optionally as corrected on `correctedAsOf` (late pre-referral evidence only). */
export function s0Window(t: number, p: Params, correctedAsOf?: number): SnapshotWindow {
  const asOf = t + p.G + p.S;
  return {
    evidenceCutoff: t + p.G,
    asOf,
    scope: "standard",
    ...correctionFor(t, p, correctedAsOf, asOf),
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
    ...correctionFor(t, p, correctedAsOf, asOf),
  };
}

/** The N largest values seen so far, kept in descending order without sorting the whole set. */
class TopN {
  readonly values: number[] = [];
  count = 0;
  constructor(private readonly n: number) {}
  add(v: number): void {
    this.count++;
    const vs = this.values;
    if (vs.length === this.n && v <= (vs[vs.length - 1] as number)) return;
    let i = vs.length;
    while (i > 0 && (vs[i - 1] as number) < v) i--;
    vs.splice(i, 0, v);
    if (vs.length > this.n) vs.pop();
  }
  mean(): number | null {
    return this.values.length === 0
      ? null
      : this.values.reduce((s, v) => s + v, 0) / this.values.length;
  }
}

const idHashes = new WeakMap<EvidenceItem, number>();
/** FNV-1a of one claim id, cached per claim. */
function idHash(item: EvidenceItem): number {
  let h = idHashes.get(item);
  if (h !== undefined) return h;
  h = 0x811c9dc5;
  for (let i = 0; i < item.id.length; i++) h = Math.imul(h ^ item.id.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  idHashes.set(item, h);
  return h;
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
  flags: FlagBook = NO_FLAGS,
): Snapshot {
  const output = new TopN(p.topN);
  const selection = new TopN(p.topN);
  // A sum of per-claim hashes: the same included set gives the same hash in any order.
  let hash = 0;
  for (const item of items) {
    if (!includedIn(item, w)) continue;
    hash = (hash + idHash(item)) >>> 0;
    let lowered = 0;
    for (const flag of flags.get(item.id) ?? []) {
      if (flag.approvedAt <= w.asOf) lowered = Math.max(lowered, flag.amount);
    }
    (item.kind === "output" ? output : selection).add(item.value - lowered);
  }
  return {
    substance: Math.max(output.mean() ?? p.sFloor, p.sFloor),
    thin: output.count < p.topN,
    selection: selection.mean() ?? 0,
    hash: hash.toString(16).padStart(8, "0"),
  };
}

// §3.6 frozen fit versions with a neutral centre --------------------------------

export interface Line {
  a: number;
  b: number;
}

export interface FitPoint {
  /** The candidate the point belongs to, so a settling candidate can be left out. */
  id: string;
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

export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

/** Normal movement for one checkpoint: e(s), the spread σ and the neutral centre c (in spread units). */
export interface MovementNorm {
  line: Line;
  spread: number;
  centre: number;
}

/** c such that the mean of g(z − c) over the fit set is 0; g is monotone, so bisect. */
export function neutralCentre(zs: readonly number[], p: Params): number {
  if (zs.length === 0) return 0;
  let lo = Math.min(...zs) - 1;
  let hi = Math.max(...zs) + 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    let sum = 0;
    for (const z of zs) sum += creditCurve(z - mid, p);
    if (sum > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function fitNorm(points: readonly FitPoint[], p: Params): MovementNorm {
  const line = fitLine(points);
  const residuals = points.map((pt) => pt.y - evalLine(line, pt.x));
  const sd = stdev(residuals);
  const spread = sd > 0 ? sd : 1;
  return {
    line,
    spread,
    centre: neutralCentre(
      residuals.map((r) => r / spread),
      p,
    ),
  };
}

/** §3.6 z in spread units, and d = g(z − c). */
export function movementZ(s0: number, sk: number, norm: MovementNorm): number {
  return (sk - s0 - evalLine(norm.line, s0)) / norm.spread;
}

export function movementBeyondNormal(
  s0: number,
  sk: number,
  norm: MovementNorm,
  p: Params,
): number {
  return creditCurve(movementZ(s0, sk, norm) - norm.centre, p);
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
  const volume = p.volumeV > 0 && t.nSettled > p.volumeV ? p.volumeV / t.nSettled : 1;
  return t.sumA + accuracy + kappaM * t.sumM * volume;
}

export function logitWeight(t: JudgeTerms, kappaM: number, p: Params): number {
  return logit(p.mu0) + p.T * Math.tanh(rawTotal(t, kappaM, p) / p.T);
}

export function weights(logitW: number, p: Params): { w: number; omega: number } {
  const w = sigmoid(logitW);
  return { w, omega: w ** p.gamma };
}

/** The soft-cap ceiling's neighbourhood: tanh(Σ/T) ≥ 0.9. */
export const nearCeiling = (logitW: number, p: Params): boolean =>
  logitW - logit(p.mu0) >= 0.9 * p.T;

// §6 the per-event bound, by event kind ----------------------------------------

export type BoundedEvent =
  | "admission"
  | "correct"
  | "accuracy"
  | "settle"
  | "resettle"
  | "ramp"
  | "flag";

/**
 * Largest change one event of each kind can make to Σ, and so to logit w
 * (tanh is 1-Lipschitz), never more than 2T, the soft cap's whole range.
 * Ramp steps and flag events (which can re-price many referrals of one judge
 * at once) are bounded only by the soft cap.
 */
export function perEventBound(kind: BoundedEvent, p: Params): number {
  const accuracySpan = logit(1 - p.eps) - logit(p.eps);
  const fadeStep = accuracySpan / (p.lambdaF + 1);
  const raw: Record<BoundedEvent, number> = {
    admission: p.LA,
    correct: 2 * Math.max(p.LA, p.kappa * p.LM),
    accuracy: accuracySpan,
    settle: p.LA + p.kappa * p.LM + fadeStep,
    resettle: 2 * p.kappa * p.LM,
    ramp: Number.POSITIVE_INFINITY,
    flag: Number.POSITIVE_INFINITY,
  };
  return Math.min(raw[kind], 2 * p.T);
}
