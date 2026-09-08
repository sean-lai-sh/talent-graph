/**
 * Bradley–Terry fit — the V1 inference core.
 *
 *   P(i ≻ j) = σ(θ_i − θ_j)
 *   L(θ)     = − Σ_{(w,l)} weight · logσ(θ_w − θ_l)          (likelihood)
 *              + λ Σ_i θ_i²                                    (L2 shrinkage)
 *              + κ Σ_{i ∈ anchored} (θ_i − θ_i^prev)²          (anchor prior, κ=0 ⇒ off)
 *
 *   ∇_i L    = − Σ_{w=i} weight·(1 − σ(θ_w − θ_l)) + Σ_{l=i} weight·(1 − σ(θ_w − θ_l))
 *              + 2λθ_i + 2κ(θ_i − θ_i^prev)
 *
 * Constraint: L is minimised subject to Σ_i θ_i = 0 within each connected
 * component. The likelihood only sees differences θ_w − θ_l, so it is
 * translation-invariant; the penalties are not. With κ = 0 the constrained
 * optimum coincides with the unconstrained one (at the unconstrained optimum
 * Σ_i ∇_i L = 2λ Σ_i θ_i = 0, so it already has zero mean). With κ > 0 the
 * solution is the critical point of L on the zero-mean hyperplane, which in
 * general differs from the centred unconstrained optimum: centring after the
 * fact would move θ off the point that was declared converged and fight the
 * anchor prior. Solving in the subspace makes the published θ exactly the
 * converged point.
 *
 * Solver: projected diagonal Newton. Each iteration computes the gradient g
 * and the diagonal curvature h_i = Σ weight·σ(1−σ) + 2λ + 2κ over i's terms,
 * projects the gradient onto the subspace (gp = g − mean(g)), takes the
 * diagonal-Newton direction d_i = −gp_i / h_i, and projects d ← d − mean(d)
 * so the iterate stays zero-mean. Because Σ gp = 0 the projection leaves the
 * directional derivative untouched: g·d = gp·d = −Σ gp_i² / h_i < 0, so d is a
 * descent direction, and Armijo backtracking on the full objective L makes
 * every iteration strictly decrease it. Convergence is ‖gp‖∞ < tol, reported
 * as `finalGradientNorm`. The warm start is centred per component before the
 * first iteration; a final re-centring is kept only to absorb floating-point
 * drift and is a no-op to machine precision. Chosen over plain gradient
 * descent because the per-node curvature differs by orders of magnitude
 * between well-observed and sparse nodes; over full Newton because it needs no
 * linear algebra and stays transparent.
 *
 * The fit runs per connected component so unrelated groups never influence
 * each other; the zero-mean constraint is per component because only within a
 * component are the θ's identified relative to one another.
 *
 * The anchor prior and warm start are engineering continuity devices for
 * re-running the model on a live graph (PLAN.md §11a), not theory: κ = 0 with
 * a warm start reproduces the plain fit to within solver tolerance.
 *
 * Confidence on a comparison is stored but **not** used here (V1).
 */

import type { Comparison, Dimension } from "../domain/types.ts";
import { CURRENT_SPECS } from "../models/registry.ts";
import { assertSpec, type BradleyTerrySpec } from "../models/spec.ts";
import { type ComponentInfo, connectedComponents } from "./components.ts";
import { logSigmoid, sigmoid } from "./logistic.ts";

export interface ComparisonObservation {
  winnerId: string;
  loserId: string;
  /** Default 1; 0.5 for each half of a tie. */
  weight?: number;
  /**
   * Id of the comparison this observation came from. Observations sharing a
   * `sourceId` (the two halves of a tie) count as one comparison in
   * `comparisonCount`; an observation without one counts as its own comparison.
   */
  sourceId?: string;
}

export interface BradleyTerryAnchor {
  /** θ from a previous run. Missing ids are simply not anchored. */
  theta: ReadonlyMap<string, number>;
  /** κ ≥ 0. Zero disables the prior but still warm-starts from `theta`. */
  strength: number;
}

export interface BradleyTerryOptions {
  /** Source of λ, maxIterations, tolerance and anchorStrength; defaults to CURRENT_SPECS. */
  spec?: BradleyTerrySpec;
  /** λ override. */
  regularization?: number;
  maxIterations?: number;
  /** Convergence on ‖∇L‖∞. */
  tolerance?: number;
  /** Initial Newton step scale (1 = full step); backtracking halves it as needed. */
  stepSize?: number;
  /** Previous-run prior and warm start. `strength` falls back to `spec.anchorStrength`. */
  anchor?: { theta: ReadonlyMap<string, number>; strength?: number };
  /** Used in component ids (`${label}:${smallest id}`). */
  label?: string;
}

export interface ResolvedBradleyTerryOptions {
  specVersion: string;
  regularization: number;
  maxIterations: number;
  tolerance: number;
  stepSize: number;
  anchorStrength: number;
  anchoredCount: number;
  label: string;
}

export interface BradleyTerryFit {
  personId: string;
  theta: number;
  /**
   * Number of distinct source comparisons the person appears in (an
   * observation without `sourceId` counts as one). Unweighted, so a single
   * heavy observation is still one comparison.
   */
  comparisonCount: number;
  /** Distinct opponents. */
  opponentCount: number;
  /** Weighted total of observations won (a half-weight tie adds 0.5). */
  wins: number;
  /** Weighted total of observations lost (a half-weight tie adds 0.5). */
  losses: number;
  componentId: string;
  componentSize: number;
}

export interface ComponentFitInfo extends ComponentInfo {
  iterations: number;
  converged: boolean;
  /** ‖g − mean(g)‖∞ at the published θ: the gradient projected onto Σθ = 0. */
  finalGradientNorm: number;
}

export interface BradleyTerryRun {
  fits: BradleyTerryFit[];
  /** Max over components. */
  iterations: number;
  /** True only if every component converged. */
  converged: boolean;
  /** Max over components. */
  finalGradientNorm: number;
  /** − Σ weight·logσ(θ_w − θ_l), unregularised, summed over components. */
  negLogLik: number;
  components: ComponentFitInfo[];
  options: ResolvedBradleyTerryOptions;
}

export interface ToObservationsOptions {
  tieHandling?: "ignore" | "half";
}

/**
 * Only outcomes "a" / "b" become observations. A tie becomes two half-weight
 * observations when `tieHandling` is "half", nothing when "ignore". `skip` and
 * `insufficient_observation` are never observations.
 */
export function toObservations(
  comparisons: readonly Comparison[],
  dimension: Dimension,
  opts: ToObservationsOptions = {},
): ComparisonObservation[] {
  const tieHandling = opts.tieHandling ?? "ignore";
  const out: ComparisonObservation[] = [];
  for (const c of comparisons) {
    if (c.dimension !== dimension) continue;
    if (c.outcome === "a") {
      out.push({ winnerId: c.personAId, loserId: c.personBId, weight: 1, sourceId: c.id });
    } else if (c.outcome === "b") {
      out.push({ winnerId: c.personBId, loserId: c.personAId, weight: 1, sourceId: c.id });
    } else if (c.outcome === "tie" && tieHandling === "half") {
      // Both halves share the comparison id, so a tie is one comparison per side.
      out.push({ winnerId: c.personAId, loserId: c.personBId, weight: 0.5, sourceId: c.id });
      out.push({ winnerId: c.personBId, loserId: c.personAId, weight: 0.5, sourceId: c.id });
    }
  }
  return out;
}

interface Indexed {
  w: number;
  l: number;
  weight: number;
}

interface ComponentSolve {
  theta: number[];
  iterations: number;
  converged: boolean;
  gradNorm: number;
  negLogLik: number;
}

function objective(
  theta: number[],
  obs: Indexed[],
  lambda: number,
  kappa: number,
  prev: Array<number | null>,
): { total: number; negLogLik: number } {
  let nll = 0;
  for (const o of obs)
    nll -= o.weight * logSigmoid((theta[o.w] as number) - (theta[o.l] as number));
  let reg = 0;
  for (let i = 0; i < theta.length; i++) {
    const t = theta[i] as number;
    reg += lambda * t * t;
    const p = prev[i] ?? null;
    if (kappa > 0 && p !== null) reg += kappa * (t - p) * (t - p);
  }
  return { total: nll + reg, negLogLik: nll };
}

function gradientAndCurvature(
  theta: number[],
  obs: Indexed[],
  lambda: number,
  kappa: number,
  prev: Array<number | null>,
): { g: number[]; h: number[] } {
  const n = theta.length;
  const g = new Array<number>(n).fill(0);
  const h = new Array<number>(n).fill(0);
  for (const o of obs) {
    const p = sigmoid((theta[o.w] as number) - (theta[o.l] as number));
    const q = 1 - p;
    g[o.w] = (g[o.w] as number) - o.weight * q;
    g[o.l] = (g[o.l] as number) + o.weight * q;
    const curv = o.weight * p * q;
    h[o.w] = (h[o.w] as number) + curv;
    h[o.l] = (h[o.l] as number) + curv;
  }
  for (let i = 0; i < n; i++) {
    const t = theta[i] as number;
    g[i] = (g[i] as number) + 2 * lambda * t;
    h[i] = (h[i] as number) + 2 * lambda;
    const p = prev[i] ?? null;
    if (kappa > 0 && p !== null) {
      g[i] = (g[i] as number) + 2 * kappa * (t - p);
      h[i] = (h[i] as number) + 2 * kappa;
    }
  }
  return { g, h };
}

const MAX_ABS_STEP = 10;
const ARMIJO_C = 1e-4;
const MAX_BACKTRACKS = 60;
const CURVATURE_FLOOR = 1e-12;

function mean(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** In place: v ← v − mean(v). Returns v. */
function centre(values: number[]): number[] {
  const m = mean(values);
  for (let i = 0; i < values.length; i++) values[i] = (values[i] as number) - m;
  return values;
}

/** ‖g − mean(g)‖∞ — the gradient norm inside the zero-mean subspace. */
function projectedGradientNorm(g: readonly number[]): number {
  const m = mean(g);
  let norm = 0;
  for (const gi of g) norm = Math.max(norm, Math.abs(gi - m));
  return norm;
}

function solveComponent(
  size: number,
  obs: Indexed[],
  init: number[],
  prev: Array<number | null>,
  lambda: number,
  kappa: number,
  maxIterations: number,
  tolerance: number,
  stepSize: number,
): ComponentSolve {
  // Solve on the zero-mean hyperplane: centre the warm start, then keep every
  // iterate there by projecting the search direction.
  const theta = centre([...init]);
  if (obs.length === 0 || size < 2) {
    // Nothing to learn: a singleton (θ = 0 after centring) or an edgeless set
    // stays at its centred warm start.
    const { negLogLik } = objective(theta, obs, lambda, kappa, prev);
    return { theta, iterations: 0, converged: true, gradNorm: 0, negLogLik };
  }

  let current = objective(theta, obs, lambda, kappa, prev);
  let iterations = 0;
  let gradNorm = Number.POSITIVE_INFINITY;
  let converged = false;

  while (iterations < maxIterations) {
    const { g, h } = gradientAndCurvature(theta, obs, lambda, kappa, prev);
    // Projected gradient gp = g − mean(g): the component of ∇L inside Σθ = 0.
    const gMean = mean(g);
    const gp = g.map((gi) => gi - gMean);
    gradNorm = 0;
    for (const gi of gp) gradNorm = Math.max(gradNorm, Math.abs(gi));
    if (gradNorm < tolerance) {
      converged = true;
      break;
    }
    iterations++;

    // Diagonal-Newton direction on the projected gradient, clipped so a
    // near-flat node cannot fling itself away, then projected back onto the
    // subspace. Since Σ gp = 0, g·d = gp·d is unchanged by the projection and
    // stays negative (each clipped d_i keeps the sign of −gp_i).
    const direction = new Array<number>(size);
    for (let i = 0; i < size; i++) {
      const d = -(gp[i] as number) / Math.max(h[i] as number, CURVATURE_FLOOR);
      direction[i] = Math.max(-MAX_ABS_STEP, Math.min(MAX_ABS_STEP, d));
    }
    centre(direction);
    let directionalDerivative = 0;
    for (let i = 0; i < size; i++) {
      directionalDerivative += (g[i] as number) * (direction[i] as number);
    }

    // Armijo backtracking: shrink the step until L actually decreases enough.
    let step = stepSize;
    let accepted = false;
    const candidate = new Array<number>(size);
    for (let bt = 0; bt < MAX_BACKTRACKS; bt++) {
      for (let i = 0; i < size; i++)
        candidate[i] = (theta[i] as number) + step * (direction[i] as number);
      const next = objective(candidate, obs, lambda, kappa, prev);
      if (next.total <= current.total + ARMIJO_C * step * directionalDerivative) {
        for (let i = 0; i < size; i++) theta[i] = candidate[i] as number;
        current = next;
        accepted = true;
        break;
      }
      step *= 0.5;
    }
    if (!accepted) {
      // Objective is flat to machine precision along this direction; treat as converged.
      converged = true;
      break;
    }
  }

  if (!converged) {
    const { g } = gradientAndCurvature(theta, obs, lambda, kappa, prev);
    gradNorm = projectedGradientNorm(g);
    converged = gradNorm < tolerance;
  }

  return { theta, iterations, converged, gradNorm, negLogLik: current.negLogLik };
}

/**
 * Fit θ for `personIds` from win/loss observations. Every id in `personIds`
 * gets a fit; ids appearing only in observations are ignored. Pure and
 * deterministic: same inputs ⇒ identical output.
 */
export function fitBradleyTerry(
  personIds: readonly string[],
  observations: readonly ComparisonObservation[],
  options: BradleyTerryOptions = {},
): BradleyTerryRun {
  const spec = assertSpec(options.spec ?? CURRENT_SPECS.bradley_terry);
  const lambda = options.regularization ?? spec.regularization;
  const maxIterations = options.maxIterations ?? spec.maxIterations;
  const tolerance = options.tolerance ?? spec.tolerance;
  const stepSize = options.stepSize ?? 1;
  const kappa = options.anchor?.strength ?? (options.anchor ? spec.anchorStrength : 0);
  const anchorTheta = options.anchor?.theta;
  const label = options.label ?? "component";

  if (!(lambda >= 0) || !(kappa >= 0) || !(tolerance > 0) || !(maxIterations >= 1)) {
    throw new Error("fitBradleyTerry: λ ≥ 0, κ ≥ 0, tolerance > 0 and maxIterations ≥ 1 required");
  }

  const ids = [...new Set(personIds)];
  const known = new Set(ids);
  const obs = observations.filter(
    (o) => known.has(o.winnerId) && known.has(o.loserId) && o.winnerId !== o.loserId,
  );

  const { byPerson, components } = connectedComponents(
    ids,
    obs.map((o) => [o.winnerId, o.loserId] as const),
    label,
  );

  // Per-person tallies (independent of the solver). wins/losses are weighted;
  // comparisonCount is the number of distinct source comparisons.
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  const opponents = new Map<string, Set<string>>();
  const sources = new Map<string, Set<string>>();
  const anonymousObs = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string, by: number) => m.set(id, (m.get(id) ?? 0) + by);
  const addTo = (m: Map<string, Set<string>>, key: string, value: string) => {
    let s = m.get(key);
    if (!s) {
      s = new Set();
      m.set(key, s);
    }
    s.add(value);
  };
  for (const o of obs) {
    const w = o.weight ?? 1;
    bump(wins, o.winnerId, w);
    bump(losses, o.loserId, w);
    addTo(opponents, o.winnerId, o.loserId);
    addTo(opponents, o.loserId, o.winnerId);
    for (const id of [o.winnerId, o.loserId]) {
      if (o.sourceId === undefined) bump(anonymousObs, id, 1);
      else addTo(sources, id, o.sourceId);
    }
  }
  const comparisonCount = (id: string) =>
    (sources.get(id)?.size ?? 0) + (anonymousObs.get(id) ?? 0);

  const obsByComponent = new Map<string, ComparisonObservation[]>();
  for (const o of obs) {
    const cid = byPerson.get(o.winnerId) as string;
    const list = obsByComponent.get(cid);
    if (list) list.push(o);
    else obsByComponent.set(cid, [o]);
  }

  const fits: BradleyTerryFit[] = [];
  const componentInfos: ComponentFitInfo[] = [];
  let maxIter = 0;
  let allConverged = true;
  let maxGrad = 0;
  let negLogLik = 0;
  let anchoredCount = 0;

  for (const comp of components) {
    const index = new Map<string, number>(comp.members.map((id, i) => [id, i]));
    const indexed: Indexed[] = (obsByComponent.get(comp.componentId) ?? []).map((o) => ({
      w: index.get(o.winnerId) as number,
      l: index.get(o.loserId) as number,
      weight: o.weight ?? 1,
    }));
    const prev: Array<number | null> = comp.members.map((id) => {
      const t = anchorTheta?.get(id);
      if (t !== undefined && Number.isFinite(t)) {
        anchoredCount++;
        return t;
      }
      return null;
    });
    const init = prev.map((p) => p ?? 0);

    const solved = solveComponent(
      comp.members.length,
      indexed,
      init,
      prev,
      lambda,
      kappa,
      maxIterations,
      tolerance,
      stepSize,
    );

    // The solver already works on Σθ = 0; this only absorbs floating-point drift.
    const centred = centre([...solved.theta]);

    for (let i = 0; i < comp.members.length; i++) {
      const id = comp.members[i] as string;
      const theta = centred[i] as number;
      if (!Number.isFinite(theta)) {
        throw new Error(`fitBradleyTerry: non-finite θ for ${id}`);
      }
      fits.push({
        personId: id,
        theta,
        comparisonCount: comparisonCount(id),
        opponentCount: opponents.get(id)?.size ?? 0,
        wins: wins.get(id) ?? 0,
        losses: losses.get(id) ?? 0,
        componentId: comp.componentId,
        componentSize: comp.members.length,
      });
    }

    componentInfos.push({
      ...comp,
      iterations: solved.iterations,
      converged: solved.converged,
      finalGradientNorm: solved.gradNorm,
    });
    maxIter = Math.max(maxIter, solved.iterations);
    allConverged = allConverged && solved.converged;
    maxGrad = Math.max(maxGrad, solved.gradNorm);
    negLogLik += solved.negLogLik;
  }

  // Preserve caller order for fits.
  const order = new Map(ids.map((id, i) => [id, i]));
  fits.sort((a, b) => (order.get(a.personId) as number) - (order.get(b.personId) as number));

  return {
    fits,
    iterations: maxIter,
    converged: allConverged,
    finalGradientNorm: maxGrad,
    negLogLik,
    components: componentInfos,
    options: {
      specVersion: spec.version,
      regularization: lambda,
      maxIterations,
      tolerance,
      stepSize,
      anchorStrength: kappa,
      anchoredCount,
      label,
    },
  };
}

/** Convenience: θ keyed by person id. */
export function thetaMap(run: BradleyTerryRun): Map<string, number> {
  return new Map(run.fits.map((f) => [f.personId, f.theta]));
}
