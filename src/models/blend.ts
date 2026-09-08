/**
 * Display-layer blending for gradual rollouts.
 *
 *   blended = (1 − α)·before + α·after
 *
 * This is for *display continuity during a rollout only*. Both underlying
 * ModelRuns are kept, and any blended value shown to a person must be
 * labelled as blended. `null` on either side propagates: missing ≠ low.
 * Not theory; see README "Operational continuity".
 */

export function blendRuns(
  before: ReadonlyMap<string, number | null>,
  after: ReadonlyMap<string, number | null>,
  alpha: number,
): Map<string, number | null> {
  if (!(alpha >= 0 && alpha <= 1))
    throw new Error(`blendRuns: alpha must be in [0,1] (got ${alpha})`);
  const out = new Map<string, number | null>();
  const ids = new Set([...before.keys(), ...after.keys()]);
  for (const id of ids) {
    const b = before.get(id) ?? null;
    const a = after.get(id) ?? null;
    out.set(id, b === null || a === null ? null : (1 - alpha) * b + alpha * a);
  }
  return out;
}

export interface AlphaScheduleParams {
  start: Date;
  /** Required for "linear". */
  end?: Date;
  now: Date;
  /** Required for "byObservations". */
  newObservationsSince?: number;
  /** Required for "byObservations"; α reaches 1 at this many new observations. */
  saturationCount?: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * α over a rollout. "linear": 0 at `start`, 1 at `end`. "byObservations":
 * new observations since the switch divided by `saturationCount`, so the new
 * model earns its weight from data rather than from the calendar.
 */
export function alphaSchedule(kind: "linear" | "byObservations", p: AlphaScheduleParams): number {
  if (kind === "linear") {
    if (!p.end) throw new Error("alphaSchedule: linear needs end");
    const span = p.end.getTime() - p.start.getTime();
    if (span <= 0) return p.now.getTime() >= p.start.getTime() ? 1 : 0;
    return clamp01((p.now.getTime() - p.start.getTime()) / span);
  }
  if (p.newObservationsSince === undefined || p.saturationCount === undefined) {
    throw new Error("alphaSchedule: byObservations needs newObservationsSince and saturationCount");
  }
  if (p.saturationCount <= 0) return 1;
  if (p.now.getTime() < p.start.getTime()) return 0;
  return clamp01(p.newObservationsSince / p.saturationCount);
}
