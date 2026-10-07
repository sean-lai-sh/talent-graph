import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planWrites } from "../apps/club/lib/clubWrites.ts";
import {
  answersForStrength,
  applyExampleAnswers,
  deploymentLabel,
  devSeedEnvError,
  EXAMPLE_AFFILIATION,
  EXAMPLE_ANCHORS,
  EXAMPLE_APPLICANTS,
  EXAMPLE_NOW,
  EXAMPLE_REFERRERS,
  emptyExampleState,
  exampleLoginAccounts,
  isDuplicateReferral,
  isExampleEmail,
  isExamplePersonId,
  linkKey,
  planExampleSeed,
  resetExampleState,
  scriptTargetError,
  seedClock,
} from "../apps/club/lib/devSeedPlan.ts";
import { computeView } from "../apps/club/lib/engine.ts";
import { signalText } from "../apps/club/lib/format.ts";
import { commitMemberReferral, referralAnswersToEngine } from "../apps/club/lib/memberReferral.ts";
import { clubToComparison, clubToPerson } from "../apps/club/lib/serialize.ts";
import type { ClubCall, ClubPerson, ClubState } from "../apps/club/lib/types.ts";
import { computeCapabilityVectors } from "../src/inference/capabilityVector.ts";
import { selectComparisons } from "../src/inference/comparisonSelection.ts";

const root = join(import.meta.dir, "..");
const clubDir = join(root, "apps/club");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function userIds(): Record<string, string> {
  return Object.fromEntries(EXAMPLE_REFERRERS.map((person) => [person.email, `user-${person.id}`]));
}

function keeper(): ClubPerson {
  return {
    id: "p-keep",
    name: "Kept Person",
    email: "keep@club.test",
    affiliation: "Town",
    status: "candidate",
    reviewStatus: "new",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function seeded(): { state: ClubState; links: { referrerUserId: string; personId: string }[] } {
  const start = emptyExampleState();
  start.people = [keeper()];
  const plan = planExampleSeed({
    state: start,
    userIdByEmail: userIds(),
    linked: new Set(),
    contacts: new Set(),
  });
  return {
    state: applyExampleAnswers(plan.state, plan.jobs),
    links: plan.links,
  };
}

describe("dev seed guards", () => {
  test("CLUB_DEV_SEED must be 1", () => {
    expect(devSeedEnvError({})).toBe(
      "Refusing to seed: CLUB_DEV_SEED is not 1. Set it only on a dev deployment with `npx convex env set CLUB_DEV_SEED 1`.",
    );
    expect(devSeedEnvError({ CLUB_DEV_SEED: "0" })).toBe(
      "Refusing to seed: CLUB_DEV_SEED is not 1. Set it only on a dev deployment with `npx convex env set CLUB_DEV_SEED 1`.",
    );
    expect(devSeedEnvError({ CLUB_DEV_SEED: "1" })).toBeNull();
  });

  test("the script refuses --prod and a prod: deployment", () => {
    expect(scriptTargetError(["--prod"], "dev:local")).toBe(
      "Refusing to seed: --prod is not allowed. seed:dev never writes production.",
    );
    expect(scriptTargetError([], "prod:club")).toBe(
      "Refusing to seed: CONVEX_DEPLOYMENT prod:club is production.",
    );
    expect(scriptTargetError([], "dev:local")).toBeNull();
    expect(scriptTargetError([], "anonymous:anonymous-agent")).toBeNull();
    expect(deploymentLabel("dev:local-example")).toBe("dev:local-example");
    expect(deploymentLabel(undefined)).toBe("(unset CONVEX_DEPLOYMENT)");
  });

  test("the seed script exits before writing when the target is production", () => {
    const prodFlag = spawnSync("bun", ["scripts/seed-dev.ts", "--prod"], {
      cwd: clubDir,
      env: {
        ...process.env,
        SEED_DEV_PASSWORD: "should-not-print",
        CONVEX_DEPLOYMENT: "dev:local",
      },
      encoding: "utf8",
    });
    expect(prodFlag.status).toBe(1);
    expect(prodFlag.stderr).toContain("Refusing to seed: --prod is not allowed.");
    expect(`${prodFlag.stdout}${prodFlag.stderr}`).not.toContain("should-not-print");

    const prodDeployment = spawnSync("bun", ["scripts/seed-dev.ts"], {
      cwd: clubDir,
      env: {
        ...process.env,
        SEED_DEV_PASSWORD: "should-not-print",
        CONVEX_DEPLOYMENT: "prod:club",
      },
      encoding: "utf8",
    });
    expect(prodDeployment.status).toBe(1);
    expect(prodDeployment.stderr).toContain(
      "Refusing to seed: CONVEX_DEPLOYMENT prod:club is production.",
    );
    expect(`${prodDeployment.stdout}${prodDeployment.stderr}`).not.toContain("should-not-print");
  });
});

describe("example workload", () => {
  test("every seeded person is marked example data", () => {
    const { state } = seeded();
    const example = state.people.filter((person) => person.id !== "p-keep");
    expect(example.length).toBe(
      EXAMPLE_REFERRERS.length + EXAMPLE_ANCHORS.length + EXAMPLE_APPLICANTS.length,
    );
    for (const person of example) {
      expect(isExamplePersonId(person.id)).toBe(true);
      expect(person.affiliation).toBe(EXAMPLE_AFFILIATION);
      expect(person.email).toBeDefined();
      expect(isExampleEmail(person.email ?? "")).toBe(true);
    }
    const kept = state.people.find((person) => person.id === "p-keep");
    expect(kept?.email).toBe("keep@club.test");
    expect(isExampleEmail("keep@club.test")).toBe(false);
  });

  test("the council list is 15 to 25 example applicants with a strength mix", () => {
    const { state } = seeded();
    const view = computeView(state);
    const applicants = view.people.filter(
      (person) => person.status === "candidate" && isExamplePersonId(person.id),
    );
    expect(applicants.length).toBeGreaterThanOrEqual(15);
    expect(applicants.length).toBeLessThanOrEqual(25);

    for (const referral of state.referrals) {
      expect(referral.createdAt <= state.now).toBe(true);
    }
    const byId = new Map(applicants.map((person) => [person.id, person]));
    expect(byId.get("ex-app-edd")?.v2Signal).toBeGreaterThanOrEqual(70);
    expect(byId.get("ex-app-fay")?.v2Signal ?? 0).toBeGreaterThanOrEqual(50);
    expect(byId.get("ex-app-fay")?.v2Signal ?? 100).toBeLessThan(70);
    expect(byId.get("ex-app-gem")?.v2Signal ?? 0).toBeGreaterThan(0);
    expect(byId.get("ex-app-gem")?.v2Signal ?? 100).toBeLessThan(30);

    const thin = applicants.filter((person) => person.v2Signal === null);
    expect(thin.length).toBeGreaterThanOrEqual(3);
    for (const person of thin) {
      expect(signalText(person.v2Signal)).toBe("Insufficient Evidence");
      expect(person.incomingCount).toBe(0);
    }
    for (const person of applicants) {
      if (person.incomingCount > 0) expect(person.v2Signal).toBeGreaterThan(0);
    }

    const mapped = {
      strong: referralAnswersToEngine(answersForStrength("strong")),
      medium: referralAnswersToEngine(answersForStrength("medium")),
      weak: referralAnswersToEngine(answersForStrength("weak")),
    };
    expect(mapped.strong.ok && mapped.strong.referral.evidenceType).toBe("firsthand_work");
    expect(mapped.medium.ok && mapped.medium.referral.conviction).toBe(4);
    expect(mapped.weak.ok && mapped.weak.referral.evidenceType).toBe("reputation");
  });

  test("every example referral has a member referral link and no direct clubReferrals insert", () => {
    const start = emptyExampleState();
    const plan = planExampleSeed({
      state: start,
      userIdByEmail: userIds(),
      linked: new Set(),
      contacts: new Set(),
    });
    const state = applyExampleAnswers(plan.state, plan.jobs);
    expect(state.referrals.length).toBe(plan.links.length);
    for (const referral of state.referrals) {
      const referrer = state.people.find((person) => person.id === referral.referrerId);
      const userId = userIds()[referrer?.email ?? ""];
      expect(
        plan.links.some(
          (link) => link.personId === referral.candidateId && link.referrerUserId === userId,
        ),
      ).toBe(true);
    }
    const two = state.referrals.filter((row) => row.candidateId === "ex-app-ivo");
    expect(two).toHaveLength(2);

    const devSeed = read("apps/club/convex/devSeed.ts");
    expect(devSeed).not.toMatch(/insert\(\s*["']clubReferrals["']/);
    expect(devSeed).toContain("saveOwnedMemberReferral(");
    expect(devSeed).toContain("now: EXAMPLE_NOW");
    expect(devSeed).toContain("insertMemberReferralLink(");
    expect(devSeed).toContain("internalMutation(");
    expect(devSeed).not.toMatch(/export const seed = mutation\(/);
    expect(read("apps/club/lib/devSeedPlan.ts")).toContain("planSignup(");
    expect(read("apps/club/lib/devSeedPlan.ts")).toContain("commitMemberReferral(");
  });

  test("each referrer has pending applicants and anchor members", () => {
    const { state } = seeded();
    const view = computeView(state);
    for (const referrer of EXAMPLE_REFERRERS) {
      const referred = state.referrals.filter((row) => row.referrerId === referrer.id);
      const anchors = referred.filter((row) => {
        const person = state.people.find((item) => item.id === row.candidateId);
        return person?.status === "member";
      });
      const applicants = referred.filter((row) => {
        const person = state.people.find((item) => item.id === row.candidateId);
        return person?.status === "candidate";
      });
      const compared = new Set(
        state.comparisons
          .filter((row) => row.evaluatorId === referrer.id)
          .flatMap((row) => [row.personAId, row.personBId]),
      );
      const pending = applicants.filter((row) => !compared.has(row.candidateId));
      expect(anchors.length).toBeGreaterThanOrEqual(4);
      expect(pending.length).toBeGreaterThanOrEqual(3);
    }

    for (const anchor of EXAMPLE_ANCHORS) {
      const person = view.people.find((item) => item.id === anchor.id);
      expect(person?.status).toBe("member");
      for (const dimension of ["problem_solving", "agency", "output"] as const) {
        const estimate = person?.dimensions.find((item) => item.dimension === dimension);
        expect(estimate?.state).toBe("estimated");
        expect(estimate?.comparisonCount).toBeGreaterThanOrEqual(3);
        expect(estimate?.opponentCount).toBeGreaterThanOrEqual(2);
      }
    }

    const run = computeCapabilityVectors(
      state.people.map(clubToPerson),
      state.comparisons.map(clubToComparison),
    );
    const proposals = selectComparisons(
      "problem_solving",
      run,
      state.comparisons.map(clubToComparison),
      {
        now: new Date("2026-01-15T15:00:00.000Z"),
        candidatePool: EXAMPLE_ANCHORS.map((person) => person.id),
      },
    );
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.some((item) => item.parts.closeness !== 0.5)).toBe(true);
  });

  test("a second plan changes no row counts and reset keeps a non-example person", () => {
    const start = emptyExampleState();
    start.people = [keeper()];
    const before = {
      people: start.people.length,
      referrals: start.referrals.length,
      comparisons: start.comparisons.length,
      evaluations: start.evaluations.length,
      feedbackRequests: start.feedbackRequests.length,
    };
    const first = planExampleSeed({
      state: start,
      userIdByEmail: userIds(),
      linked: new Set(),
      contacts: new Set(),
    });
    const once = applyExampleAnswers(first.state, first.jobs);
    const linked = new Set(first.links.map((link) => linkKey(link.referrerUserId, link.personId)));
    const contacts = new Set(first.contacts.map((contact) => contact.normalizedContact));
    const second = planExampleSeed({
      state: once,
      userIdByEmail: userIds(),
      linked,
      contacts,
    });
    const twice = applyExampleAnswers(second.state, second.jobs);
    expect(second.links).toEqual([]);
    expect(second.contacts).toEqual([]);
    expect(twice.people).toHaveLength(once.people.length);
    expect(twice.referrals).toHaveLength(once.referrals.length);
    expect(twice.comparisons).toHaveLength(once.comparisons.length);
    expect(isDuplicateReferral("duplicate referral from ex-ada-referrer to ex-app-edd")).toBe(true);

    const reset = resetExampleState(twice);
    expect(reset.people.map((person) => person.id)).toEqual(["p-keep"]);
    expect(reset.referrals).toEqual([]);
    expect(reset.comparisons).toEqual([]);
    expect({
      people: reset.people.length,
      referrals: reset.referrals.length,
      comparisons: reset.comparisons.length,
      evaluations: reset.evaluations.length,
      feedbackRequests: reset.feedbackRequests.length,
    }).toEqual(before);
  });

  function seedOnce(state: ClubState, linked = new Set<string>(), contacts = new Set<string>()) {
    const plan = planExampleSeed({ state, userIdByEmail: userIds(), linked, contacts });
    return {
      state: applyExampleAnswers(plan.state, plan.jobs),
      linked: new Set([
        ...linked,
        ...plan.links.map((link) => linkKey(link.referrerUserId, link.personId)),
      ]),
      contacts: new Set([...contacts, ...plan.contacts.map((row) => row.normalizedContact)]),
    };
  }

  test("the seed on a club whose clock is later than the seed date leaves club.now alone", () => {
    const start = emptyExampleState();
    start.now = "2026-09-28T12:00:00.000Z";
    const { state } = seedOnce(start);
    expect(state.now).toBe("2026-09-28T12:00:00.000Z");
    expect(planWrites(start, state).club).toEqual({});
    for (const referral of state.referrals) expect(referral.createdAt).toBe(EXAMPLE_NOW);
    for (const comparison of state.comparisons) expect(comparison.createdAt).toBe(EXAMPLE_NOW);
  });

  test("the seed on an earlier or empty clock sets club.now to the seed date", () => {
    expect(seedClock("2025-06-01T00:00:00.000Z")).toBe(EXAMPLE_NOW);
    expect(seedClock("")).toBe(EXAMPLE_NOW);
    expect(seedClock(EXAMPLE_NOW)).toBe(EXAMPLE_NOW);
    expect(seedClock("2026-09-28T12:00:00.000Z")).toBe("2026-09-28T12:00:00.000Z");

    const earlier = emptyExampleState();
    earlier.now = "2025-06-01T00:00:00.000Z";
    expect(seedOnce(earlier).state.now).toBe(EXAMPLE_NOW);
    const empty = emptyExampleState();
    empty.now = "";
    expect(seedOnce(empty).state.now).toBe(EXAMPLE_NOW);
  });

  test("a real member referral saved after seeding still counts after a second seed run", () => {
    const start = emptyExampleState();
    start.people = [
      keeper(),
      { ...keeper(), id: "p-real", name: "Real Member", email: "real@club.test", status: "member" },
    ];
    const first = seedOnce(start);
    expect(first.state.now).toBe(EXAMPLE_NOW);

    const savedAt = "2026-09-28T12:00:00.000Z";
    const saved = commitMemberReferral({
      state: first.state,
      email: "real@club.test",
      candidateId: "p-keep",
      referredByUser: true,
      answers: answersForStrength("strong"),
      submittedAt: savedAt,
    });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.state.now).toBe(savedAt);

    const second = seedOnce(saved.state, first.linked, first.contacts);
    expect(second.state.now).toBe(savedAt);
    expect(second.state.referrals).toHaveLength(saved.state.referrals.length);
    const real = second.state.referrals.find((row) => row.referrerId === "p-real");
    expect(real?.createdAt).toBe(savedAt);
    const keep = computeView(second.state).people.find((person) => person.id === "p-keep");
    expect(keep?.incomingCount).toBe(1);
    expect(keep?.v0Signal).toBeGreaterThan(0);
  });

  test("the seed plan has no admin account and the report does not name one", () => {
    const accounts = exampleLoginAccounts();
    expect(accounts.length).toBe(EXAMPLE_REFERRERS.length);
    for (const account of accounts) expect(account.role).toBe("member");
    const plan = read("apps/club/lib/devSeedPlan.ts");
    const devSeed = read("apps/club/convex/devSeed.ts");
    const script = read("apps/club/scripts/seed-dev.ts");
    expect(plan).not.toContain('role: "admin"');
    expect(devSeed).not.toContain("adminEmail");
    expect(script).not.toContain("adminEmail");
    expect(script).not.toContain("admin login");
  });

  test("reset deletes calls on example people and keeps the rest", () => {
    const { state } = seeded();
    const applicant = EXAMPLE_APPLICANTS[0]?.id as string;
    const referrer = EXAMPLE_REFERRERS[0]?.id as string;
    const call = (id: string, candidateId: string, callerId: string): ClubCall => ({
      id,
      candidateId,
      callerId,
      order: 1,
      outcome: "yes",
      createdAt: EXAMPLE_NOW,
    });
    state.calls = [
      call("call-example-candidate", applicant, "p-keep"),
      call("call-example-caller", "p-keep", referrer),
      call("call-kept", "p-keep", "p-keep"),
    ];
    expect(resetExampleState(state).calls.map((row) => row.id)).toEqual(["call-kept"]);
    const body = read("apps/club/convex/devSeed.ts").split("async function deleteExampleRows")[1];
    expect(body).toContain('.query("clubCalls")');
    expect(body).toContain("isExamplePersonId(row.candidateId) || isExamplePersonId(row.callerId)");
  });
});

describe("verify-club local backend", () => {
  test("doctor refuses a non-local Convex URL in local-backend mode", () => {
    const script = [
      "source .cursor/skills/verify-club/helpers/lib.sh",
      "assert_local_backend_convex_url 'https://happy-animal-123.convex.cloud'",
    ].join("\n");
    const refused = spawnSync("bash", ["-c", script], { cwd: root, encoding: "utf8" });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("local-backend mode refuses a non-local Convex URL");

    const allowed = spawnSync(
      "bash",
      [
        "-c",
        "source .cursor/skills/verify-club/helpers/lib.sh\nconvex_url_is_local 'http://127.0.0.1:3210'\nconvex_url_is_local 'http://localhost:3210'",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(allowed.status).toBe(0);
    expect(read(".cursor/skills/verify-club/helpers/doctor.sh")).toContain(
      "assert_local_backend_convex_url",
    );
  });

  test("the local admin step refuses a cloud Convex URL and does not provision", () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-club-admin-"));
    const invoked = join(dir, "invoked");
    writeFileSync(
      join(dir, "bun"),
      `#!/bin/sh\nprintf '%s\\n' invoked >> ${JSON.stringify(invoked)}\nexit 0\n`,
      { mode: 0o755 },
    );
    const refused = spawnSync(
      "bash",
      [".cursor/skills/verify-club/helpers/provision-local-admin.sh"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH ?? ""}`,
          NEXT_PUBLIC_CONVEX_URL: "https://happy-animal-123.convex.cloud",
          NEXT_PUBLIC_CONVEX_SITE_URL: "https://happy-animal-123.convex.site",
          SEED_DEV_PASSWORD: "should-not-print",
          ADMIN_PROVISION_SECRET: "should-not-print",
        },
      },
    );
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("local-backend mode refuses a non-local Convex URL");
    expect(refused.stdout + refused.stderr).not.toContain("should-not-print");
    expect(existsSync(invoked)).toBe(false);
  });
});
