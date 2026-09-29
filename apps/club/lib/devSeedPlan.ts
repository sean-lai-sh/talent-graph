/**
 * Fake example workload for a dev Convex deployment.
 * Person ids, emails, and the answer chips are the whole seed.
 * `planExampleSeed` only adds missing rows, so a second plan is empty.
 */

import type { Dimension } from "../../../src/domain/types.ts";
import { addComparison, EXAMPLE_REQUIRED_DIMENSIONS, emptyState } from "./engine.ts";
import { commitMemberReferral } from "./memberReferral.ts";
import { planSignup } from "./referralSignup.ts";
import type {
  ClubComparison,
  ClubPerson,
  ClubState,
  IsoDate,
  MemberReferralAnswers,
} from "./types.ts";

export const EXAMPLE_NOW = "2026-01-15T15:00:00.000Z";
export const EXAMPLE_AFFILIATION = "Example data";
export const EXAMPLE_CLUB_NAME = "Example club (dev)";

export type ReferralStrength = "strong" | "medium" | "weak";

export type ExampleLogin = {
  email: string;
  name: string;
  role: "member";
};

type ExampleMember = { id: string; name: string; email: string };
type ExampleApplicant = ExampleMember & { strength: ReferralStrength | "none" };

export const EXAMPLE_REFERRERS: readonly ExampleMember[] = [
  { id: "ex-ada-referrer", name: "Ada Quill", email: "ada.quill@example.test" },
  { id: "ex-bo-referrer", name: "Bo Harp", email: "bo.harp@example.test" },
  { id: "ex-cy-referrer", name: "Cy Linden", email: "cy.linden@example.test" },
  { id: "ex-di-referrer", name: "Di Moss", email: "di.moss@example.test" },
];

export const EXAMPLE_ANCHORS: readonly ExampleMember[] = [
  { id: "ex-anchor-nia", name: "Nia Calder", email: "nia.calder@example.test" },
  { id: "ex-anchor-om", name: "Om Dyer", email: "om.dyer@example.test" },
  { id: "ex-anchor-pia", name: "Pia Elkin", email: "pia.elkin@example.test" },
  { id: "ex-anchor-quin", name: "Quin Frost", email: "quin.frost@example.test" },
  { id: "ex-anchor-ren", name: "Ren Gale", email: "ren.gale@example.test" },
  { id: "ex-anchor-sol", name: "Sol Hedges", email: "sol.hedges@example.test" },
  { id: "ex-anchor-tia", name: "Tia Iver", email: "tia.iver@example.test" },
  { id: "ex-anchor-una", name: "Una Joss", email: "una.joss@example.test" },
  { id: "ex-anchor-val", name: "Val Kemp", email: "val.kemp@example.test" },
  { id: "ex-anchor-wes", name: "Wes Lumen", email: "wes.lumen@example.test" },
];

export const EXAMPLE_APPLICANTS: readonly ExampleApplicant[] = [
  { id: "ex-app-ash", name: "Ash Plover", email: "ash.plover@example.test", strength: "none" },
  { id: "ex-app-bay", name: "Bay Otter", email: "bay.otter@example.test", strength: "none" },
  { id: "ex-app-clem", name: "Clem Newt", email: "clem.newt@example.test", strength: "none" },
  { id: "ex-app-dove", name: "Dove Finch", email: "dove.finch@example.test", strength: "none" },
  { id: "ex-app-edd", name: "Edd Pike", email: "edd.pike@example.test", strength: "strong" },
  { id: "ex-app-fay", name: "Fay Rook", email: "fay.rook@example.test", strength: "medium" },
  { id: "ex-app-gem", name: "Gem Tern", email: "gem.tern@example.test", strength: "weak" },
  { id: "ex-app-holt", name: "Holt Ibis", email: "holt.ibis@example.test", strength: "strong" },
  { id: "ex-app-jade", name: "Jade Wren", email: "jade.wren@example.test", strength: "medium" },
  { id: "ex-app-kit", name: "Kit Voss", email: "kit.voss@example.test", strength: "weak" },
  { id: "ex-app-lux", name: "Lux Holm", email: "lux.holm@example.test", strength: "strong" },
  { id: "ex-app-moe", name: "Moe Aster", email: "moe.aster@example.test", strength: "medium" },
  { id: "ex-app-nell", name: "Nell Quinn", email: "nell.quinn@example.test", strength: "weak" },
  { id: "ex-app-pip", name: "Pip Orr", email: "pip.orr@example.test", strength: "strong" },
  { id: "ex-app-rem", name: "Rem Ives", email: "rem.ives@example.test", strength: "medium" },
  { id: "ex-app-sue", name: "Sue Dale", email: "sue.dale@example.test", strength: "weak" },
  { id: "ex-app-ivo", name: "Ivo Lark", email: "ivo.lark@example.test", strength: "medium" },
  { id: "ex-app-orio", name: "Orio Beck", email: "orio.beck@example.test", strength: "strong" },
];

type ReferralEdge = { referrerId: string; personId: string; strength: ReferralStrength };

const ANCHOR_EDGES: readonly ReferralEdge[] = [
  edge("ex-ada-referrer", "ex-anchor-nia"),
  edge("ex-ada-referrer", "ex-anchor-om"),
  edge("ex-ada-referrer", "ex-anchor-pia"),
  edge("ex-ada-referrer", "ex-anchor-quin"),
  edge("ex-bo-referrer", "ex-anchor-pia"),
  edge("ex-bo-referrer", "ex-anchor-quin"),
  edge("ex-bo-referrer", "ex-anchor-ren"),
  edge("ex-bo-referrer", "ex-anchor-sol"),
  edge("ex-cy-referrer", "ex-anchor-ren"),
  edge("ex-cy-referrer", "ex-anchor-sol"),
  edge("ex-cy-referrer", "ex-anchor-tia"),
  edge("ex-cy-referrer", "ex-anchor-una"),
  edge("ex-di-referrer", "ex-anchor-tia"),
  edge("ex-di-referrer", "ex-anchor-una"),
  edge("ex-di-referrer", "ex-anchor-val"),
  edge("ex-di-referrer", "ex-anchor-wes"),
];

const APPLICANT_EDGES: readonly ReferralEdge[] = [
  edge("ex-ada-referrer", "ex-app-edd", "strong"),
  edge("ex-ada-referrer", "ex-app-fay", "medium"),
  edge("ex-ada-referrer", "ex-app-gem", "weak"),
  edge("ex-ada-referrer", "ex-app-ivo", "medium"),
  edge("ex-bo-referrer", "ex-app-holt", "strong"),
  edge("ex-bo-referrer", "ex-app-jade", "medium"),
  edge("ex-bo-referrer", "ex-app-kit", "weak"),
  edge("ex-bo-referrer", "ex-app-ivo", "medium"),
  edge("ex-cy-referrer", "ex-app-lux", "strong"),
  edge("ex-cy-referrer", "ex-app-moe", "medium"),
  edge("ex-cy-referrer", "ex-app-nell", "weak"),
  edge("ex-cy-referrer", "ex-app-orio", "strong"),
  edge("ex-di-referrer", "ex-app-pip", "strong"),
  edge("ex-di-referrer", "ex-app-rem", "medium"),
  edge("ex-di-referrer", "ex-app-sue", "weak"),
  edge("ex-di-referrer", "ex-app-orio", "strong"),
];

export const EXAMPLE_REFERRAL_EDGES: readonly ReferralEdge[] = [
  ...ANCHOR_EDGES,
  ...APPLICANT_EDGES,
];

const ANSWERS: Record<ReferralStrength, MemberReferralAnswers> = {
  strong: {
    context: "Built something together with a deadline",
    length: "2+ years",
    stakes: ["A ship date or competition"],
    what: "Example data. A made-up project, not a real person.",
    hard: "Example data. The hard part is invented.",
    distinct: "Example data. Nothing here is a real observation.",
    role: "Major contributor",
    rank: "Top 5%",
    groupSize: "100+",
  },
  medium: {
    context: "Class project",
    length: "3 to 12 months",
    stakes: ["No"],
    what: "Example data. A made-up class project.",
    hard: "Example data. Invented difficulty.",
    distinct: "Example data. Invented contribution.",
    role: "Major contributor",
    rank: "Top 20%",
    groupSize: "10 to 30",
  },
  weak: {
    context: "Heard about them from others",
    length: "under 3 months",
    stakes: ["No"],
    what: "Example data. Heard a made-up story.",
    hard: "Example data. Hard to say.",
    distinct: "Example data. No firsthand observation.",
    role: "I only heard about it",
    rank: "Hard to say",
    groupSize: "under 10",
  },
};

export type PlannedContact = {
  normalizedContact: string;
  kind: "email";
  personId: string;
};

export type PlannedLink = {
  referrerUserId: string;
  normalizedContact: string;
  personId: string;
  createdAt: string;
  tokenHash: string;
};

export type AnswerJob = {
  referrerEmail: string;
  candidateId: string;
  answers: MemberReferralAnswers;
};

export type ExamplePlan = {
  state: ClubState;
  contacts: PlannedContact[];
  links: PlannedLink[];
  jobs: AnswerJob[];
};

export function answersForStrength(strength: ReferralStrength): MemberReferralAnswers {
  return ANSWERS[strength];
}

export function exampleLoginAccounts(): ExampleLogin[] {
  return EXAMPLE_REFERRERS.map((person) => ({
    email: person.email,
    name: person.name,
    role: "member" as const,
  }));
}

export function devSeedEnvError(env: { CLUB_DEV_SEED?: string }): string | null {
  if (env.CLUB_DEV_SEED === "1") return null;
  return "Refusing to seed: CLUB_DEV_SEED is not 1. Set it only on a dev deployment with `npx convex env set CLUB_DEV_SEED 1`.";
}

export function scriptTargetError(
  argv: readonly string[],
  deployment: string | undefined,
): string | null {
  if (argv.includes("--prod")) {
    return "Refusing to seed: --prod is not allowed. seed:dev never writes production.";
  }
  if ((deployment ?? "").startsWith("prod:")) {
    return `Refusing to seed: CONVEX_DEPLOYMENT ${deployment} is production.`;
  }
  return null;
}

export function deploymentLabel(deployment: string | undefined): string {
  if (!deployment) return "(unset CONVEX_DEPLOYMENT)";
  return deployment;
}

export function isExamplePersonId(id: string): boolean {
  return id.startsWith("ex-");
}

export function isExampleEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@example.test");
}

export function isDuplicateReferral(error: string): boolean {
  return error.includes("duplicate referral");
}

export function emptyExampleState(): ClubState {
  const state = emptyState(EXAMPLE_NOW);
  state.config = { requiredDimensions: [...EXAMPLE_REQUIRED_DIMENSIONS] };
  return state;
}

/** The seed never moves the club clock back; an unset or unparsable clock takes the seed date. */
export function seedClock(current: IsoDate): IsoDate {
  return Date.parse(current) > Date.parse(EXAMPLE_NOW) ? current : EXAMPLE_NOW;
}

export function planExampleSeed(input: {
  state: ClubState;
  userIdByEmail: Readonly<Record<string, string>>;
  linked: ReadonlySet<string>;
  contacts: ReadonlySet<string>;
}): ExamplePlan {
  let state: ClubState = { ...input.state, now: EXAMPLE_NOW, people: [...input.state.people] };
  for (const referrer of EXAMPLE_REFERRERS) {
    if (state.people.some((person) => person.id === referrer.id)) continue;
    state.people.push(memberPerson(referrer));
  }

  const personById = new Map(state.people.map((person) => [person.id, person]));
  const contacts: PlannedContact[] = [];
  const links: PlannedLink[] = [];
  const jobs: AnswerJob[] = [];
  const seenContact = new Set(input.contacts);

  for (const referral of EXAMPLE_REFERRAL_EDGES) {
    const referrer = EXAMPLE_REFERRERS.find((person) => person.id === referral.referrerId);
    const target = findTarget(referral.personId);
    if (!referrer || !target) {
      throw new Error(
        `example referral ${referral.referrerId} → ${referral.personId} is not in the roster`,
      );
    }
    const userId = input.userIdByEmail[referrer.email];
    if (!userId) {
      throw new Error(`example referrer ${referrer.email} has no login user id`);
    }
    if (!personById.has(target.id)) {
      const created = referredPerson(target, referrer, userId);
      state.people.push(created);
      personById.set(created.id, created);
    }
    if (!seenContact.has(target.email)) {
      contacts.push({ normalizedContact: target.email, kind: "email", personId: target.id });
      seenContact.add(target.email);
    }
    const linkKey = `${userId}|${target.id}`;
    if (!input.linked.has(linkKey)) {
      links.push({
        referrerUserId: userId,
        normalizedContact: target.email,
        personId: target.id,
        createdAt: EXAMPLE_NOW,
        tokenHash: exampleTokenHash(referrer.id, target.id),
      });
    }
    jobs.push({
      referrerEmail: referrer.email,
      candidateId: target.id,
      answers: answersForStrength(referral.strength),
    });
  }

  for (const applicant of EXAMPLE_APPLICANTS) {
    if (applicant.strength !== "none") continue;
    if (state.people.some((person) => person.id === applicant.id)) continue;
    state.people.push({
      id: applicant.id,
      name: applicant.name,
      email: applicant.email,
      affiliation: EXAMPLE_AFFILIATION,
      status: "candidate",
      reviewStatus: "new",
      createdAt: EXAMPLE_NOW,
      updatedAt: EXAMPLE_NOW,
      linkedin: `https://example.test/${applicant.id}`,
    });
  }

  state = addAnchorComparisons(state);
  return { state: { ...state, now: seedClock(input.state.now) }, contacts, links, jobs };
}

export function applyAnswerJob(
  state: ClubState,
  job: AnswerJob,
):
  | { ok: true; state: ClubState; already: boolean }
  | { ok: false; error: string; state: ClubState } {
  const result = commitMemberReferral({
    state,
    email: job.referrerEmail,
    candidateId: job.candidateId,
    referredByUser: true,
    answers: job.answers,
    submittedAt: EXAMPLE_NOW,
  });
  if (result.ok) return { ok: true, state: result.state, already: false };
  if (isDuplicateReferral(result.error)) return { ok: true, state, already: true };
  return { ok: false, error: result.error, state };
}

export function applyExampleAnswers(state: ClubState, jobs: readonly AnswerJob[]): ClubState {
  let next = state;
  for (const job of jobs) {
    const applied = applyAnswerJob(next, job);
    if (!applied.ok) throw new Error(applied.error);
    next = applied.state;
  }
  return next;
}

export function resetExampleState(state: ClubState): ClubState {
  const keep = (id: string) => !isExamplePersonId(id);
  return {
    ...state,
    people: state.people.filter((person) => keep(person.id)),
    referrals: state.referrals.filter((row) => keep(row.referrerId) && keep(row.candidateId)),
    comparisons: state.comparisons.filter(
      (row) => keep(row.evaluatorId) && keep(row.personAId) && keep(row.personBId),
    ),
    evaluations: state.evaluations.filter((row) => keep(row.evaluatorId) && keep(row.candidateId)),
    feedbackRequests: state.feedbackRequests.filter(
      (row) => keep(row.candidateId) && keep(row.memberId),
    ),
  };
}

export function linkKey(userId: string, personId: string): string {
  return `${userId}|${personId}`;
}

function edge(
  referrerId: string,
  personId: string,
  strength: ReferralStrength = "strong",
): ReferralEdge {
  return { referrerId, personId, strength };
}

function memberPerson(spec: ExampleMember): ClubPerson {
  return {
    id: spec.id,
    name: spec.name,
    email: spec.email,
    affiliation: EXAMPLE_AFFILIATION,
    status: "member",
    reviewStatus: "admitted",
    createdAt: EXAMPLE_NOW,
    updatedAt: EXAMPLE_NOW,
  };
}

function referredPerson(spec: ExampleMember, referrer: ExampleMember, userId: string): ClubPerson {
  const anchor = EXAMPLE_ANCHORS.some((person) => person.id === spec.id);
  const plan = planSignup({
    rawContact: spec.email,
    actor: { userId, email: referrer.email },
    profileExists: false,
    referrerAlreadyLinked: false,
    draft: {
      name: spec.name,
      affiliation: EXAMPLE_AFFILIATION,
      linkedin: `https://example.test/${spec.id}`,
      x: "",
      website: "",
      github: "",
    },
    now: EXAMPLE_NOW,
    personId: spec.id,
    tokenHash: exampleTokenHash(referrer.id, spec.id),
  });
  if (plan.action !== "create") {
    const detail = plan.action === "rejected" ? plan.error : plan.action;
    throw new Error(`example person ${spec.id} did not plan as create (${detail})`);
  }
  if (!anchor) return plan.person;
  return { ...plan.person, status: "member", reviewStatus: "admitted" };
}

function findTarget(id: string): ExampleMember | undefined {
  return (
    EXAMPLE_ANCHORS.find((person) => person.id === id) ??
    EXAMPLE_APPLICANTS.find((person) => person.id === id)
  );
}

function exampleTokenHash(referrerId: string, personId: string): string {
  return `ex-token-${referrerId}-${personId}`;
}

function addAnchorComparisons(state: ClubState): ClubState {
  const ids = EXAMPLE_ANCHORS.map((person) => person.id);
  const dimensions = requiredDimensions(state);
  let next = state;
  for (const dimension of dimensions) {
    for (let index = 0; index < ids.length; index++) {
      for (const offset of [1, 2]) {
        const personAId = ids[index];
        const personBId = ids[(index + offset) % ids.length];
        const evaluatorId = ids[(index + 5) % ids.length];
        if (!personAId || !personBId || !evaluatorId) continue;
        if (hasPair(next.comparisons, personAId, personBId, dimension)) continue;
        const result = addComparison(next, {
          personAId,
          personBId,
          dimension,
          outcome: index % 2 === 0 ? "a" : "b",
          confidence: 4,
          evaluatorId,
          evidenceText: "Example data. A made-up member comparison.",
        });
        if (result.error) throw new Error(result.error);
        next = result.state;
      }
    }
  }
  return next;
}

function requiredDimensions(state: ClubState): readonly Dimension[] {
  if (state.config.requiredDimensions.length > 0) return state.config.requiredDimensions;
  return EXAMPLE_REQUIRED_DIMENSIONS;
}

function hasPair(
  comparisons: readonly ClubComparison[],
  personAId: string,
  personBId: string,
  dimension: Dimension,
): boolean {
  return comparisons.some(
    (row) =>
      row.dimension === dimension &&
      ((row.personAId === personAId && row.personBId === personBId) ||
        (row.personAId === personBId && row.personBId === personAId)),
  );
}
