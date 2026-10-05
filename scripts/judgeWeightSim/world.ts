/**
 * A synthetic club: candidates with latent level A, slope g and an optional
 * heavy-tailed breakout, their dated evidence and how it reaches us, judges'
 * referral intents, the council and the organising committee. A world is
 * plain data generated once from a seed; it never depends on the r8
 * parameters, so the sweep can replay one world under many parameter sets.
 * The only feedback path is the council, which `sim.ts` runs live because it
 * reads the judge weights.
 */

import { gaussian, mulberry32, type Rng } from "../../src/seed/prng.ts";
import type { Channel, Decision, EvidenceItem, Recognition } from "./model.ts";

export const MONTH = 30;

export interface JudgeSpec {
  id: string;
  /** What the judge is in the scenario, for the report. */
  role: string;
  /** Designed true skill at spotting slope; the order the weights should recover. */
  skill: number;
  admin: boolean;
}

export type CredentialPath = "pre-credential" | "consensus" | "neither" | "unconventional";

export interface CandidateSpec {
  id: string;
  intakeDay: number;
  A: number;
  /** Substance gained per year. */
  g: number;
  credential: CredentialPath;
  /** A step rise on `day`, for out-of-distribution candidates. */
  breakout: { day: number; jump: number } | null;
  items: EvidenceItem[];
  /** The same evidence submitted on time; set only for candidates who withheld some. */
  onTimeItems: EvidenceItem[] | null;
}

export interface ReferralIntent {
  id: string;
  judge: string;
  candidate: string;
  day: number;
  /** R_uv, the referral's stated strength in (0, 1]. */
  strength: number;
  answer: Recognition;
}

export type Council =
  | {
      kind: "scored";
      /** Weight on the Referral Signal, in units of one μ0-weight full-strength referral. */
      signal: number;
      /** Weight on the z-score of the substance the council can see today. */
      substance: number;
      /** Weight on the z-score of selection: the credentials bias. */
      credentials: number;
      threshold: number;
      noise: ReadonlyMap<string, number>;
    }
  | { kind: "scripted"; decisions: ReadonlyMap<string, Decision> };

export interface World {
  name: string;
  days: number;
  judges: JudgeSpec[];
  candidates: CandidateSpec[];
  intents: ReferralIntent[];
  council: Council;
  /** Days from a candidate's first referral to the council's decision. */
  decisionLag: number;
  /** decidedBy for each candidate's decision. */
  deciders: ReadonlyMap<string, readonly string[]>;
  /** Later decisions on a candidate (reopen or reversal), applied as recorded history. */
  reversals: { candidate: string; day: number; decision: Decision }[];
  /** Organising committee members (§3.11) and each one's prediction noise. */
  committee: ReadonlyMap<string, number>;
  /** Population level used for the council's z-scores and committee predictions. */
  population: { meanA: number; sdA: number; meanG: number };
}

/** Substance the candidate truly has on `day`. */
export function trueLevel(c: Omit<CandidateSpec, "items" | "onTimeItems">, day: number): number {
  const jump = c.breakout && day >= c.breakout.day ? c.breakout.jump : 0;
  return c.A + (c.g * (day - c.intakeDay)) / 365 + jump;
}

// --- generator -----------------------------------------------------------------

export interface JudgeArchetype {
  id: string;
  role: string;
  skill: number;
  admin?: boolean;
  /** Perception noise on A and on g. */
  levelNoise: number;
  slopeNoise: number;
  /** Days after intake the judge looks at a candidate. */
  lagDays: number;
  /** 0 judges on perceived substance and slope, 1 on visible credentials. */
  consensus: number;
  /** Refers when the perceived z-score exceeds this. */
  pickZ: number;
  /** Probability the recognition answer is honest; otherwise "Not yet". */
  honesty: number;
  /** Refers every candidate on intake day at full strength. */
  spray?: boolean;
  /** Refers whatever this judge refers, one day later, at full strength. */
  follows?: string;
  /** Exaggerates output claims dated after the judge's referral. */
  coaches?: boolean;
  /** Share of candidates who are the judge's friends: referred on intake day regardless. */
  friendsShare?: number;
  /** Firsthand knowledge: perceives an out-of-distribution breakout coming within 3 years. */
  seesBreakouts?: boolean;
}

export interface OodConfig {
  /** Share of candidates who are out of distribution. */
  share: number;
  /** Monthly probability they submit an output claim themselves. */
  pSubmitted: number;
  /** Breakout arrives this many days after intake, uniformly. */
  breakoutFrom: number;
  breakoutTo: number;
  /** Share of post-breakout evidence only a committee check finds; the rest is public. */
  pDeep: number;
}

export interface WorldConfig {
  name: string;
  days: number;
  /** Candidate arrivals, spread uniformly over the first `arrivalDays` days. */
  candidates: number;
  arrivalDays: number;
  /** Monthly probability a candidate produces a dated output item. */
  pEvidence: number;
  /** Share of candidates whose evidence reaches us 3–6 months late. */
  slowShare: number;
  judges: JudgeArchetype[];
  council:
    | { kind: "scored"; signal: number; substance: number; credentials: number; threshold: number }
    | { kind: "scripted"; admitRate: number };
  councilNoise: number;
  decidersPerDecision: number;
  /** Exaggeration added to coached output claims. */
  coachBoost: number;
  /** Probability a committee flags an exaggerated claim, about two months after it appears. */
  flagRate: number;
  /** Friends of coaching judges hold back their two best pre-intake outputs until intake + this. */
  withholdUntil: number | null;
  ood: OodConfig | null;
}

const POP = { meanA: 0.5, sdA: 0.12, meanG: 0.02, sdG: 0.08 };
/** Perceived score is level plus one year of slope. */
const PERCEIVED_MEAN = POP.meanA + POP.meanG;
const ITEM_NOISE = 0.05;
const HISTORY_DAYS = 720;
const FLAG_LAG = 60;

const uniform = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

interface Latent extends Omit<CandidateSpec, "items" | "onTimeItems"> {
  gap0: number;
  premium: number;
  slow: boolean;
}

/**
 * Credentials. Pre-credential candidates start `gap0` below substance and
 * catch up over about 18 months from intake; consensus candidates sit a
 * premium above substance; unconventional ones sit far below and never catch
 * up; the rest track substance.
 */
function selectionLevel(c: Latent, day: number): number {
  const lvl = trueLevel(c, day);
  switch (c.credential) {
    case "pre-credential":
      return lvl - c.gap0 * Math.exp(-Math.max(0, day - c.intakeDay) / 540);
    case "consensus":
      return lvl + c.premium;
    case "unconventional":
      return c.A - 0.2;
    case "neither":
      return lvl;
  }
}

/** Pareto(1.5) excess: heavy-tailed, mean 2. */
const paretoExcess = (rng: Rng): number => (1 - rng()) ** (-1 / 1.5) - 1;

function drawLatent(rng: Rng, id: string, intakeDay: number, cfg: WorldConfig): Latent {
  const A = POP.meanA + POP.sdA * gaussian(rng);
  const g = POP.meanG + POP.sdG * gaussian(rng);
  const gap0 = uniform(rng, 0.12, 0.25);
  const premium = uniform(rng, 0.03, 0.15);
  const slow = rng() < cfg.slowShare;
  if (cfg.ood && rng() < cfg.ood.share) {
    const day = intakeDay + Math.round(uniform(rng, cfg.ood.breakoutFrom, cfg.ood.breakoutTo));
    const jump = Math.min(0.6, 0.08 + 0.06 * paretoExcess(rng));
    return {
      id,
      intakeDay,
      A,
      g: POP.meanG,
      credential: "unconventional",
      breakout: { day, jump },
      gap0,
      premium,
      slow,
    };
  }
  // Fast risers are more often ahead of their credentials.
  const pPre = 0.1 + 0.4 * normalCdf((g - POP.meanG) / POP.sdG);
  const u = rng();
  const credential: CredentialPath =
    u < pPre ? "pre-credential" : u < pPre + 0.35 ? "consensus" : "neither";
  return { id, intakeDay, A, g, credential, breakout: null, gap0, premium, slow };
}

function drawItems(rng: Rng, c: Latent, cfg: WorldConfig): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const start = c.intakeDay - HISTORY_DAYS;
  const ood = c.credential === "unconventional" ? cfg.ood : null;
  const arrive = (dated: number): number =>
    Math.round(
      Math.max(dated, c.intakeDay) + (c.slow ? uniform(rng, 90, 180) : uniform(rng, 0, 14)),
    );
  const item = (
    kind: EvidenceItem["kind"],
    dated: number,
    value: number,
    channel: Channel,
  ): EvidenceItem => ({
    id: `${c.id}:${kind[0]}${items.length}`,
    kind,
    datedAt: dated,
    availableAt: channel === "submitted" ? arrive(dated) : dated + MONTH,
    channel,
    value,
    inflation: 0,
    flaggedAt: null,
  });
  for (let month = start; month < cfg.days; month += MONTH) {
    const dated = Math.round(month + uniform(rng, 0, MONTH - 1));
    const value = trueLevel(c, dated) + ITEM_NOISE * gaussian(rng);
    if (!ood) {
      if (rng() < cfg.pEvidence) items.push(item("output", dated, value, "submitted"));
      continue;
    }
    // Out of distribution: a thin trail of their own submissions; after the
    // breakout, the rise shows up publicly or only to someone who digs.
    if (rng() < ood.pSubmitted) items.push(item("output", dated, value, "submitted"));
    if (c.breakout && dated >= c.breakout.day && rng() < cfg.pEvidence) {
      items.push(item("output", dated, value, rng() < ood.pDeep ? "deep" : "public"));
    }
  }
  for (let dated = start; dated < cfg.days; dated += 180) {
    items.push(
      item("selection", dated, selectionLevel(c, dated) + 0.03 * gaussian(rng), "submitted"),
    );
  }
  return items;
}

function honestAnswer(perceivedGap: number, perceivedG: number): Recognition {
  if (perceivedGap > 0.08) return "not_yet";
  if (perceivedG > 0.06) return "soon";
  if (perceivedGap < -0.03) return "yes";
  return "not_sure";
}

function judgeIntent(
  rng: Rng,
  j: JudgeArchetype,
  c: Latent,
  friend: boolean,
): Omit<ReferralIntent, "id"> | null {
  const base = { judge: j.id, candidate: c.id };
  if (j.spray || friend) {
    return { ...base, day: c.intakeDay, strength: 1, answer: "not_yet" };
  }
  const day = Math.round(c.intakeDay + j.lagDays + uniform(rng, 0, 20));
  const foresight =
    j.seesBreakouts && c.breakout && c.breakout.day <= day + 3 * 365 ? c.breakout.jump : 0;
  const seenA = c.A + j.levelNoise * gaussian(rng);
  const seenG = c.g + j.slopeNoise * gaussian(rng) + foresight;
  const sel = selectionLevel(c, day);
  const perceived = (1 - j.consensus) * (seenA + seenG) + j.consensus * sel;
  // Each judge refers the same share of candidates as it perceives them, so
  // perception noise changes which candidates a judge picks, not how many.
  const ownSd = Math.sqrt(
    POP.sdA ** 2 +
      (1 - j.consensus) ** 2 * (POP.sdG ** 2 + j.levelNoise ** 2 + j.slopeNoise ** 2) +
      (j.consensus * 0.06) ** 2,
  );
  const z = (perceived - PERCEIVED_MEAN) / ownSd;
  if (z <= j.pickZ) return null;
  const answer = rng() < j.honesty ? honestAnswer(seenA + foresight - sel, seenG) : "not_yet";
  return { ...base, day, strength: Math.min(1, Math.max(0.05, normalCdf(z))), answer };
}

export function generateWorld(cfg: WorldConfig, seed: number): World {
  const rng = mulberry32(seed);
  const latents: Latent[] = [];
  for (let i = 0; i < cfg.candidates; i++) {
    const day = Math.floor((i * cfg.arrivalDays) / cfg.candidates + uniform(rng, 0, MONTH));
    latents.push(drawLatent(rng, `c${latents.length}`, day, cfg));
  }

  const intents: ReferralIntent[] = [];
  const coachedFrom = new Map<string, number>();
  const withholders = new Set<string>();
  for (const c of latents) {
    const own: ReferralIntent[] = [];
    for (const j of cfg.judges) {
      if (j.follows) continue;
      const friend = rng() < (j.friendsShare ?? 0);
      const intent = judgeIntent(rng, j, c, friend);
      if (!intent) continue;
      own.push({ ...intent, id: `${j.id}>${c.id}` });
      if (j.coaches) {
        coachedFrom.set(c.id, Math.min(coachedFrom.get(c.id) ?? Infinity, intent.day));
        if (friend && cfg.withholdUntil !== null) withholders.add(c.id);
      }
    }
    for (const f of cfg.judges) {
      if (!f.follows) continue;
      const lead = own.find((r) => r.judge === f.follows);
      if (lead) {
        own.push({ ...lead, id: `${f.id}>${c.id}`, judge: f.id, day: lead.day + 1, strength: 1 });
      }
    }
    intents.push(...own);
  }

  const candidates: CandidateSpec[] = latents.map((c) => {
    const coachDay = coachedFrom.get(c.id);
    const onTime = drawItems(rng, c, cfg).map((item) => {
      if (coachDay === undefined || item.kind !== "output" || item.datedAt <= coachDay) return item;
      const flagged = rng() < cfg.flagRate;
      return {
        ...item,
        value: item.value + cfg.coachBoost,
        inflation: cfg.coachBoost,
        flaggedAt: flagged ? item.availableAt + FLAG_LAG : null,
      };
    });
    let items = onTime;
    if (withholders.has(c.id) && cfg.withholdUntil !== null) {
      const held = new Set(
        onTime
          .filter((i) => i.kind === "output" && i.datedAt <= c.intakeDay)
          .sort((x, y) => y.value - x.value)
          .slice(0, 2)
          .map((i) => i.id),
      );
      const until = c.intakeDay + cfg.withholdUntil;
      items = onTime.map((i) => (held.has(i.id) ? { ...i, availableAt: until } : i));
    }
    const { gap0: _gap0, premium: _premium, slow: _slow, ...latent } = c;
    return { ...latent, items, onTimeItems: items === onTime ? null : onTime };
  });

  const admins = cfg.judges.filter((j) => j.admin).map((j) => j.id);
  const deciders = new Map<string, string[]>();
  const noise = new Map<string, number>();
  const scripted = new Map<string, Decision>();
  for (const c of latents) {
    const pool = [...admins];
    const chosen: string[] = [];
    while (chosen.length < Math.min(cfg.decidersPerDecision, admins.length)) {
      const idx = Math.floor(rng() * pool.length);
      chosen.push(pool.splice(idx, 1)[0] as string);
    }
    deciders.set(c.id, chosen.sort());
    noise.set(c.id, cfg.councilNoise * gaussian(rng));
    if (cfg.council.kind === "scripted") {
      scripted.set(c.id, rng() < cfg.council.admitRate ? "admit" : "deny");
    }
  }
  const committee = new Map(admins.map((id) => [id, uniform(rng, 0.02, 0.1)]));

  return {
    name: cfg.name,
    days: cfg.days,
    judges: cfg.judges.map((j) => ({
      id: j.id,
      role: j.role,
      skill: j.skill,
      admin: j.admin ?? false,
    })),
    candidates,
    intents: intents.sort((x, y) => x.day - y.day || (x.id < y.id ? -1 : 1)),
    council:
      cfg.council.kind === "scored"
        ? { ...cfg.council, noise }
        : { kind: "scripted", decisions: scripted },
    decisionLag: MONTH,
    deciders,
    reversals: [],
    committee,
    population: { meanA: POP.meanA, sdA: POP.sdA, meanG: POP.meanG },
  };
}
