/**
 * Deterministic synthetic dataset for tests and the demo.
 *
 * Hidden per-person, per-dimension abilities drive the comparison outcomes
 * via P(i ≻ j) = σ(θ_i − θ_j), so Bradley–Terry has a known ordering to
 * recover. The hidden values never leave this module.
 */

import { DIMENSIONS } from "../domain/constants.ts";
import type {
  Comparison,
  ComparisonOutcome,
  Dimension,
  Evaluation,
  Person,
  Referral,
  RubricScore,
  Scale5,
} from "../domain/types.ts";
import { PERSONAS, type Persona } from "./personas.ts";
import { gaussian, int, mulberry32, pick, type Rng, shuffle } from "./prng.ts";

export interface SeedDataset {
  people: Person[];
  referrals: Referral[];
  evaluations: Evaluation[];
  comparisons: Comparison[];
}

export interface SeedOptions {
  seed?: number;
  /** Total people including the six personas. */
  people?: number;
  /** Target referral count (personas' referrals are included in this). */
  referrals?: number;
  /** Target comparison count (personas' minimums are met first). */
  comparisons?: number;
  /** Target rubric evaluation count. */
  evaluations?: number;
}

const BASE_DATE = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

const FIRST_NAMES = [
  "Noor",
  "Tomas",
  "Ife",
  "Kai",
  "Mira",
  "Sasha",
  "Rafael",
  "Wren",
  "Yusuf",
  "Leah",
  "Anouk",
  "Hugo",
  "Priya",
  "Elio",
  "Zara",
  "Otto",
  "Sunny",
  "Idris",
  "Vera",
  "Milo",
  "Tess",
  "Arjun",
  "Lina",
  "Cassian",
  "Ruth",
  "Beniamino",
  "Hana",
  "Oren",
  "Dagny",
  "Felix",
];
const LAST_NAMES = [
  "Haddad",
  "Lindqvist",
  "Adeyemi",
  "Nakamura",
  "Petrov",
  "Okoye",
  "Silva",
  "Byrne",
  "Farouk",
  "Goldberg",
  "de Vries",
  "Marchetti",
  "Iyer",
  "Costa",
  "Rahimi",
  "Weber",
  "Park",
  "Bello",
  "Novak",
  "Rossi",
  "Doyle",
  "Mehta",
  "Karlsson",
  "Duval",
  "Levi",
  "Ricci",
  "Sato",
  "Katz",
  "Solberg",
  "Brandt",
];
const AFFILIATIONS = [
  "Independent",
  "Northgate Labs",
  "Harrow & Finch",
  "Civic Data Collective",
  "Unaffiliated",
  "Meridian Research",
  "Open Compute Guild",
  "Blue Harbor Ventures",
];

const REFERRAL_EVIDENCE = [
  "Watched them take a stalled migration and land it in a week with no hand-holding.",
  "They found the root cause of a flaky test cluster that three of us had given up on.",
  "Read their design doc; it anticipated failure modes the rest of us only hit in prod.",
  "Paired for a month. They learn a new codebase faster than anyone I have worked with.",
  "They quietly rewrote our scheduler over a weekend and it has been solid since.",
  "Heard consistently good things from two people I trust, but have not worked with them.",
  "Reviewed their open-source project; the abstractions are unusually clean.",
  "They taught the whole team a technique that halved our incident count.",
  "We shared an office for a year. They pick the right problem more often than not.",
  "Their talk was the only one at the workshop that changed how I think.",
  "Saw them onboard onto an unfamiliar ML stack and ship a result in two weeks.",
  "Reputation only; several strong people mention them unprompted.",
];

const EVALUATION_EVIDENCE = [
  "Reframed the problem so the hard part disappeared; nobody else saw it.",
  "Delivered a working prototype before the design review was even scheduled.",
  "Picked up the new language and shipped a production change within days.",
  "Consistently chooses the sharper, smaller approach over the obvious one.",
  "The junior engineers around them are noticeably stronger after a quarter.",
  "Produced an idea in the retro that reshaped our roadmap.",
  "Turns half-formed asks into a plan and starts executing without being told.",
  "Have only seen them in meetings; nothing concrete to report.",
];

const RUBRIC_SCORES: readonly RubricScore[] = [0, 1, 2, 3, 4];
const SCALE: readonly Scale5[] = [1, 2, 3, 4, 5];

function date(offsetDays: number): Date {
  return new Date(BASE_DATE + offsetDays * DAY);
}

function sigmoid(x: number): number {
  return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
}

function pad(n: number): string {
  return n.toString().padStart(3, "0");
}

interface HiddenPerson {
  person: Person;
  theta: Record<Dimension, number | null>;
  minComparisons: number;
  maxComparisons: number | null;
  focus: Dimension[];
}

function buildPeople(rng: Rng, total: number): HiddenPerson[] {
  const out: HiddenPerson[] = [];
  const personaById = new Map<string, Persona>(PERSONAS.map((p) => [p.id, p]));

  for (const persona of PERSONAS) {
    const created = int(rng, 0, 40);
    out.push({
      person: {
        id: persona.id,
        name: persona.name,
        bio: persona.bio,
        affiliation: persona.affiliation,
        status: "candidate",
        createdAt: date(created),
        updatedAt: date(created + int(rng, 0, 10)),
      },
      theta: { ...persona.trueTheta },
      minComparisons: persona.minComparisons,
      maxComparisons: persona.maxComparisons,
      focus: persona.focusDimensions,
    });
  }

  const others = Math.max(0, total - PERSONAS.length);
  const firsts = shuffle(rng, FIRST_NAMES);
  const lasts = shuffle(rng, LAST_NAMES);
  for (let i = 0; i < others; i++) {
    const id = `p-${pad(i + 1)}`;
    const base = gaussian(rng) * 0.8;
    const theta = {} as Record<Dimension, number | null>;
    for (const d of DIMENSIONS) theta[d] = base + gaussian(rng) * 0.5;
    const created = int(rng, 0, 60);
    out.push({
      person: {
        id,
        name: `${firsts[i % firsts.length]} ${lasts[i % lasts.length]}`,
        affiliation: pick(rng, AFFILIATIONS),
        status: "candidate",
        createdAt: date(created),
        updatedAt: date(created + int(rng, 0, 10)),
      },
      theta,
      minComparisons: 0,
      maxComparisons: null,
      focus: [],
    });
  }

  // ~8 members (they also act as referrers and evaluators), 1–2 archived.
  const nonPersona = out.filter((h) => !personaById.has(h.person.id));
  const memberCount = Math.min(8, nonPersona.length);
  const chosen = shuffle(rng, nonPersona);
  for (let i = 0; i < memberCount; i++) {
    const h = chosen[i];
    if (h) h.person.status = "member";
  }
  const archived = chosen.slice(memberCount, memberCount + 2);
  for (const h of archived) h.person.status = "archived";

  return out;
}

function buildReferrals(rng: Rng, people: HiddenPerson[], target: number): Referral[] {
  const referrals: Referral[] = [];
  const pairs = new Set<string>();
  const members = people.filter((h) => h.person.status === "member").map((h) => h.person.id);
  const everyone = people.map((h) => h.person.id);
  let n = 0;

  const add = (
    referrerId: string,
    candidateId: string,
    shape: Pick<Referral, "conviction" | "confidence" | "relationshipDepth" | "evidenceType">,
  ): boolean => {
    if (referrerId === candidateId) return false;
    const key = `${referrerId}→${candidateId}`;
    if (pairs.has(key)) return false;
    pairs.add(key);
    n++;
    const created = int(rng, 5, 120);
    referrals.push({
      id: `ref-${pad(n)}`,
      referrerId,
      candidateId,
      ...shape,
      evidenceText: pick(rng, REFERRAL_EVIDENCE),
      createdAt: date(created),
      updatedAt: date(created),
    });
    return true;
  };

  // Persona referrals: referrers drawn from members first, then anyone.
  for (const persona of PERSONAS) {
    const pool = shuffle(rng, [...members, ...everyone.filter((id) => !members.includes(id))]);
    let i = 0;
    for (const shape of persona.referrals) {
      while (i < pool.length && !add(pool[i] as string, persona.id, shape)) i++;
      i++;
    }
  }

  // Random fill among everyone else; personas' incoming counts are fixed above.
  const personaIds = new Set(PERSONAS.map((p) => p.id));
  const candidates = everyone.filter((id) => !personaIds.has(id));
  const referrers = [...members, ...shuffle(rng, candidates).slice(0, 10)];
  let guard = 0;
  while (referrals.length < target && guard++ < target * 20) {
    const referrerId = pick(rng, referrers);
    const candidateId = pick(rng, candidates);
    add(referrerId, candidateId, {
      conviction: pick(rng, SCALE),
      confidence: pick(rng, SCALE),
      relationshipDepth: pick(rng, SCALE),
      evidenceType: pick(rng, [
        "firsthand_work",
        "firsthand_work",
        "firsthand_personal",
        "artifact",
        "reputation",
        "other",
      ] as const),
    });
  }

  return referrals.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1),
  );
}

function buildComparisons(rng: Rng, people: HiddenPerson[], target: number): Comparison[] {
  const comparisons: Comparison[] = [];
  const counts = new Map<string, number>(people.map((h) => [h.person.id, 0]));
  const evaluators = people.filter((h) => h.person.status === "member").map((h) => h.person.id);
  let n = 0;

  const canCompare = (h: HiddenPerson, d: Dimension): boolean =>
    h.theta[d] !== null &&
    (h.maxComparisons === null || (counts.get(h.person.id) ?? 0) < h.maxComparisons);

  const add = (a: HiddenPerson, b: HiddenPerson, d: Dimension): void => {
    const evaluatorPool = evaluators.filter((e) => e !== a.person.id && e !== b.person.id);
    const evaluatorId = pick(rng, evaluatorPool);
    const roll = rng();
    let outcome: ComparisonOutcome;
    let winnerId: string | null = null;
    if (roll < 0.06) outcome = "skip";
    else if (roll < 0.1) outcome = "insufficient_observation";
    else if (roll < 0.15) outcome = "tie";
    else {
      const ta = a.theta[d] as number;
      const tb = b.theta[d] as number;
      const aWins = rng() < sigmoid(ta - tb);
      outcome = aWins ? "a" : "b";
      winnerId = aWins ? a.person.id : b.person.id;
    }
    n++;
    counts.set(a.person.id, (counts.get(a.person.id) ?? 0) + 1);
    counts.set(b.person.id, (counts.get(b.person.id) ?? 0) + 1);
    const withEvidence = rng() < 0.3;
    const c: Comparison = {
      id: `cmp-${pad(n)}`,
      evaluatorId,
      personAId: a.person.id,
      personBId: b.person.id,
      dimension: d,
      outcome,
      winnerId,
      confidence:
        outcome === "skip" || outcome === "insufficient_observation" ? null : pick(rng, SCALE),
      createdAt: date(int(rng, 10, 150)),
    };
    if (withEvidence) c.evidenceText = pick(rng, EVALUATION_EVIDENCE);
    comparisons.push(c);
  };

  // Opponent pool for persona minimums: anyone without a cap, excluding the persona.
  const opponentsFor = (h: HiddenPerson, d: Dimension): HiddenPerson[] =>
    people.filter((o) => o !== h && o.maxComparisons === null && canCompare(o, d));

  // 1. Meet each persona's minimum on its focus dimensions (round-robin).
  for (const h of people) {
    if (h.minComparisons === 0) continue;
    let i = 0;
    let guard = 0;
    while ((counts.get(h.person.id) ?? 0) < h.minComparisons && guard++ < 1000) {
      const d = h.focus[i % h.focus.length] as Dimension;
      i++;
      if (!canCompare(h, d)) continue;
      const opp = pick(rng, opponentsFor(h, d));
      if (rng() < 0.5) add(h, opp, d);
      else add(opp, h, d);
    }
  }

  // 2. Random fill to the target across all dimensions.
  const uncapped = people.filter((h) => h.maxComparisons === null);
  let guard = 0;
  while (comparisons.length < target && guard++ < target * 20) {
    const d = pick(rng, DIMENSIONS);
    const a = pick(rng, uncapped);
    const b = pick(rng, uncapped);
    if (a === b || !canCompare(a, d) || !canCompare(b, d)) continue;
    add(a, b, d);
  }

  return comparisons.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1),
  );
}

function buildEvaluations(rng: Rng, people: HiddenPerson[], target: number): Evaluation[] {
  const evaluations: Evaluation[] = [];
  const evaluators = people.filter((h) => h.person.status === "member").map((h) => h.person.id);
  const candidates = people.map((h) => h.person.id);
  const seen = new Set<string>();
  let n = 0;
  let guard = 0;
  while (evaluations.length < target && guard++ < target * 20) {
    const evaluatorId = pick(rng, evaluators);
    const candidateId = pick(rng, candidates);
    const dimension = pick(rng, DIMENSIONS);
    if (evaluatorId === candidateId) continue;
    const key = `${evaluatorId}|${candidateId}|${dimension}`;
    if (seen.has(key)) continue;
    seen.add(key);
    n++;
    const notObserved = rng() < 0.2;
    const created = int(rng, 20, 160);
    evaluations.push({
      id: `eval-${pad(n)}`,
      evaluatorId,
      candidateId,
      dimension,
      score: notObserved ? null : pick(rng, RUBRIC_SCORES),
      confidence: notObserved ? null : pick(rng, SCALE),
      evidenceText: notObserved
        ? (EVALUATION_EVIDENCE[EVALUATION_EVIDENCE.length - 1] as string)
        : pick(rng, EVALUATION_EVIDENCE.slice(0, -1)),
      createdAt: date(created),
      updatedAt: date(created),
    });
  }
  return evaluations;
}

export function generateSeed(opts: SeedOptions = {}): SeedDataset {
  const seed = opts.seed ?? 42;
  const rng = mulberry32(seed);

  const hidden = buildPeople(rng, opts.people ?? 32);
  const referrals = buildReferrals(rng, hidden, opts.referrals ?? 50);
  const comparisons = buildComparisons(rng, hidden, opts.comparisons ?? 140);
  const evaluations = buildEvaluations(rng, hidden, opts.evaluations ?? 24);

  return {
    people: hidden.map((h) => h.person),
    referrals,
    evaluations,
    comparisons,
  };
}
