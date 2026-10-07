import { describe, expect, test } from "bun:test";
import schema from "../apps/club/convex/schema.ts";
import { admissionObservations } from "../apps/club/lib/engine/admission.ts";
import { addCall, addPerson, addReferral, decide, emptyState } from "../apps/club/lib/engine.ts";
import { clubToReferral, reviveState } from "../apps/club/lib/serialize.ts";
import type { ClubState, ReferralRecognition } from "../apps/club/lib/types.ts";
import type { Person, Referral } from "../src/domain/types.ts";
import {
  type AdmissionObservations,
  admissionSign,
  type Channel,
  type CouncilDecision,
  computeAdmission,
  positionShare,
  referralPositions,
} from "../src/judges/admission.ts";
import { computeJudgeCalibration } from "../src/judges/reliability.ts";
import { JUDGE_RELIABILITY_V4_1_0 } from "../src/models/registry.ts";

const SPEC = JUDGE_RELIABILITY_V4_1_0;
const ADM = SPEC.admission as NonNullable<typeof SPEC.admission>;
const T0 = new Date("2026-01-01T00:00:00.000Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(T0.getTime() + n * DAY);
const NOW = day(400);

let seq = 0;

function referral(from: string, to: string, at: number): Referral {
  seq++;
  return {
    id: `r-${seq}`,
    referrerId: from,
    candidateId: to,
    conviction: 4,
    confidence: 4,
    relationshipDepth: 4,
    evidenceType: "firsthand_work",
    evidenceText: "Seen it.",
    createdAt: day(at),
    updatedAt: day(at),
  };
}

function person(id: string): Person {
  return { id, name: id, status: "candidate", createdAt: T0, updatedAt: T0 };
}

function decision(
  over: Partial<CouncilDecision> & Pick<CouncilDecision, "candidateId">,
): CouncilDecision {
  return { outcome: "admitted", at: day(30), signal: 10, signalWithout: [], ...over };
}

const obs = (
  decisions: CouncilDecision[],
  channels: [string, Channel][] = [],
): AdmissionObservations => ({ decisions, channels: new Map(channels) });

const admit = (refs: Referral[], o: AdmissionObservations) => computeAdmission(refs, o, ADM, NOW);

describe("admission credit", () => {
  test("recusal: the judge who recorded the decision earns nothing, others still do", () => {
    const mine = referral("alice", "bob", 1);
    const other = referral("carol", "bob", 2);
    const d = decision({
      candidateId: "bob",
      decidedBy: "alice",
      signalWithout: [
        { referrerId: "alice", signalWithout: 10 },
        { referrerId: "carol", signalWithout: 10 },
      ],
    });
    const res = admit([mine, other], obs([d]));
    expect(res.sumByJudge.has("alice")).toBe(false);
    expect(res.terms.some((t) => t.judgeId === "alice")).toBe(false);
    expect(res.sumByJudge.get("carol") as number).toBeGreaterThan(0);
  });

  function single(outcome: "admitted" | "denied", without: number) {
    const ref = referral("alice", "bob", 1);
    return admit(
      [ref],
      obs([
        decision({
          candidateId: "bob",
          outcome,
          signalWithout: [{ referrerId: "alice", signalWithout: without }],
        }),
      ]),
    ).terms[0];
  }

  test("ρ = 1 gives 0 early credit, admitted or denied; ρ = 0 gives the full credit", () => {
    for (const outcome of ["admitted", "denied"] as const) {
      const carried = single(outcome, 0);
      expect(carried?.reliance).toBe(1);
      expect(carried?.credit).toBe(0);
    }
    const unaided = single("admitted", 10);
    expect(unaided?.reliance).toBe(0);
    expect(unaided?.credit).toBeCloseTo(ADM.kappa, 12);
    expect(single("admitted", 5)?.credit).toBeCloseTo(ADM.kappa / 2, 12);
  });

  test("a frozen signal of 0 gives 0 credit, sole advocate or several", () => {
    for (const outcome of ["admitted", "denied"] as const) {
      const ref = referral("alice", "bob", 1);
      const term = admit(
        [ref],
        obs([
          decision({
            candidateId: "bob",
            outcome,
            signal: 0,
            signalWithout: [{ referrerId: "alice", signalWithout: 0 }],
          }),
        ]),
      ).terms[0];
      expect(term?.credit).toBe(0);
    }
    const refs = ["alice", "carol", "dave"].map((from, i) => referral(from, "bob", i + 1));
    const res = admit(
      refs,
      obs([
        decision({
          candidateId: "bob",
          signal: 0,
          signalWithout: ["alice", "carol", "dave"].map((referrerId) => ({
            referrerId,
            signalWithout: 0,
          })),
        }),
      ]),
    );
    expect(res.terms).toHaveLength(3);
    for (const t of res.terms) expect(t.credit).toBe(0);
    expect(single("admitted", 10)?.credit).toBeCloseTo(ADM.kappa, 12);
  });

  test("expected early credit is 0 at the base rate for ρ in {0, 0.5, 1}", () => {
    for (const priorAdmitRate of [ADM.priorAdmitRate, 0.08, 0.3]) {
      for (const without of [10, 5, 0]) {
        const yes = referral("alice", "bob", 1);
        const no = referral("alice", "cid", 1);
        const signalWithout = [{ referrerId: "alice", signalWithout: without }];
        const res = computeAdmission(
          [yes, no],
          obs([
            decision({ candidateId: "bob", outcome: "admitted", signalWithout }),
            decision({ candidateId: "cid", outcome: "denied", signalWithout }),
          ]),
          { ...ADM, priorAdmitRate },
          NOW,
        );
        const r = res.admitRate.inbound;
        const [admitted, denied] = [yes, no].map((x) =>
          res.terms.find((t) => t.referralId === x.id),
        );
        expect(admitted?.reliance).toBe(1 - without / 10);
        expect(denied?.reliance).toBe(admitted?.reliance as number);
        expect(Math.abs(denied?.credit as number)).toBeLessThan(ADM.limit);
        expect(r * (admitted?.credit as number) + (1 - r) * (denied?.credit as number)).toBeCloseTo(
          0,
          12,
        );
      }
    }
  });

  test("a denial's debit shrinks as ρ grows", () => {
    const debits = [10, 7, 3, 0].map((without) => single("denied", without)?.credit as number);
    expect(debits[0]).toBeLessThan(0);
    for (let i = 1; i < debits.length; i++)
      expect(debits[i]).toBeGreaterThan(debits[i - 1] as number);
    expect(debits[3]).toBe(0);
  });

  test("at the base rate, expected admission credit is 0", () => {
    for (const r of [0.02, 0.08, 0.3, 0.5, 0.9]) {
      expect(r * admissionSign("admitted", r) + (1 - r) * admissionSign("denied", r)).toBeCloseTo(
        0,
        12,
      );
    }
    const refs: Referral[] = [];
    const decisions: CouncilDecision[] = [];
    for (let i = 0; i < 150; i++) {
      const c = `c${i}`;
      refs.push(referral("alice", c, 1));
      decisions.push(
        decision({
          candidateId: c,
          outcome: i < 12 ? "admitted" : "denied",
          signalWithout: [{ referrerId: "alice", signalWithout: 10 }],
        }),
      );
    }
    const res = admit(refs, obs(decisions));
    expect(res.admitRate.inbound).toBeCloseTo(12 / 150, 12);
    expect(res.sumByJudge.get("alice") as number).toBeCloseTo(0, 9);
  });

  test("a judge whose candidates are admitted above the base rate earns, below it loses", () => {
    const run = (admitted: number) => {
      const refs: Referral[] = [];
      const decisions: CouncilDecision[] = [];
      for (let i = 0; i < 150; i++) {
        refs.push(referral("alice", `c${i}`, 1));
        decisions.push(
          decision({
            candidateId: `c${i}`,
            outcome: i < admitted ? "admitted" : "denied",
            signalWithout: [{ referrerId: "alice", signalWithout: 10 }],
          }),
        );
      }
      return admit(refs, obs(decisions)).sumByJudge.get("alice") as number;
    };
    expect(run(30)).toBeGreaterThan(0);
    expect(run(2)).toBeLessThan(0);
  });

  function history(judge: string, prefix: string, admitted: number, total = 150) {
    const refs: Referral[] = [];
    const decisions: CouncilDecision[] = [];
    for (let i = 0; i < total; i++) {
      const c = `${prefix}${i}`;
      refs.push(referral(judge, c, 1));
      decisions.push(
        decision({
          candidateId: c,
          outcome: i < admitted ? "admitted" : "denied",
          signalWithout: [{ referrerId: judge, signalWithout: 10 }],
        }),
      );
    }
    return { refs, decisions };
  }

  test("the admit rate comes from history, pulled toward the prior", () => {
    const { refs, decisions } = history("alice", "c", 75);
    const res = admit(refs, obs(decisions));
    const prior = ADM.priorAdmitRate * ADM.priorAdmitWeight;
    expect(res.admitRate.inbound).toBeCloseTo((75 + prior) / (150 + ADM.priorAdmitWeight), 12);
    expect(res.admitRate.inbound).toBeGreaterThan(0.25);
    expect(res.admitRate.outbound).toBeCloseTo(ADM.priorAdmitRate, 12);
    const denied = res.terms.find((t) => t.decision === "denied");
    expect(denied?.sign).toBeCloseTo(-res.admitRate.inbound / (1 - res.admitRate.inbound), 12);
  });

  test("inbound and outbound keep separate admit rates, and a denial uses its candidate's", () => {
    const inbound = history("alice", "in", 75);
    const outbound = history("carol", "out", 3);
    const channels: [string, Channel][] = outbound.decisions.map((d) => [
      d.candidateId,
      "outbound",
    ]);
    const res = admit(
      [...inbound.refs, ...outbound.refs],
      obs([...inbound.decisions, ...outbound.decisions], channels),
    );
    const prior = ADM.priorAdmitRate * ADM.priorAdmitWeight;
    const rIn = (75 + prior) / (150 + ADM.priorAdmitWeight);
    const rOut = (3 + prior) / (150 + ADM.priorAdmitWeight);
    expect(res.admitRate.inbound).toBeCloseTo(rIn, 12);
    expect(res.admitRate.outbound).toBeCloseTo(rOut, 12);
    const deniedSign = (judge: string) =>
      res.terms.find((t) => t.judgeId === judge && t.decision === "denied")?.sign;
    expect(deniedSign("alice")).toBeCloseTo(-rIn / (1 - rIn), 12);
    expect(deniedSign("carol")).toBeCloseTo(-rOut / (1 - rOut), 12);
  });

  const PRIOR = ADM.priorAdmitRate * ADM.priorAdmitWeight;
  const blended = (admitted: number, total: number) =>
    (admitted + PRIOR) / (total + ADM.priorAdmitWeight);

  test("re-application: earlier referrers carry the denial, the new referrer the admit", () => {
    const early = referral("alice", "bob", 1);
    const late = referral("carol", "bob", 40);
    const denial = decision({
      candidateId: "bob",
      outcome: "denied",
      at: day(30),
      signalWithout: [{ referrerId: "alice", signalWithout: 0 }],
    });
    const admission = decision({
      candidateId: "bob",
      outcome: "admitted",
      at: day(60),
      signalWithout: [
        { referrerId: "alice", signalWithout: 0 },
        { referrerId: "carol", signalWithout: 0 },
      ],
    });
    const res = admit([early, late], obs([admission, denial]));
    expect(res.terms.map((t) => [t.judgeId, t.decision])).toEqual([
      ["alice", "denied"],
      ["carol", "admitted"],
    ]);
    const r = blended(1, 2);
    expect(res.admitRate.inbound).toBeCloseTo(r, 12);
    expect(res.terms[0]?.sign).toBeCloseTo(-r / (1 - r), 12);
    expect(res.terms[1]?.sign).toBe(1);
    expect(res.positions.get(late.id)?.position).toBe(2);
  });

  test("a reopen with no new referral changes nothing and its decision is not counted in r", () => {
    const ref = referral("alice", "bob", 1);
    const denial = decision({
      candidateId: "bob",
      outcome: "denied",
      at: day(30),
      signalWithout: [{ referrerId: "alice", signalWithout: 0 }],
    });
    const once = admit([ref], obs([denial]));
    const readmitted = decision({
      candidateId: "bob",
      outcome: "admitted",
      at: day(60),
      signalWithout: [{ referrerId: "alice", signalWithout: 0 }],
    });
    const res = admit([ref], obs([denial, readmitted]));
    expect(res.terms).toEqual(once.terms);
    expect(res.terms.map((t) => [t.judgeId, t.decision])).toEqual([["alice", "denied"]]);
    expect(res.admitRate.inbound).toBeCloseTo(blended(0, 1), 12);
  });

  test("r counts a scoring decision once per channel, however many referrals it scores", () => {
    const both = [referral("alice", "bob", 1), referral("carol", "bob", 2)];
    const outRefs = [referral("frank", "eve", 1), referral("gina", "eve", 2)];
    const without = (refs: Referral[]) =>
      refs.map((r) => ({ referrerId: r.referrerId, signalWithout: 0 }));
    const res = admit(
      [...both, ...outRefs],
      obs(
        [
          decision({ candidateId: "bob", outcome: "admitted", signalWithout: without(both) }),
          decision({ candidateId: "dave", outcome: "denied" }),
          decision({ candidateId: "eve", outcome: "denied", signalWithout: without(outRefs) }),
        ],
        [["eve", "outbound"]],
      ),
    );
    expect(res.terms).toHaveLength(4);
    expect(res.admitRate.inbound).toBeCloseTo(blended(1, 1), 12);
    expect(res.admitRate.outbound).toBeCloseTo(blended(0, 1), 12);
  });

  test("a decision recorded without signalWithout is unscored, never read as low", () => {
    const ref = referral("alice", "bob", 1);
    const res = admit(
      [ref],
      obs([{ candidateId: "bob", outcome: "denied", at: day(30), signal: 10 }]),
    );
    expect(res.terms).toEqual([]);
    expect(res.sumByJudge.size).toBe(0);
  });

  test("a referral made at the instant of a decision is scored on that decision", () => {
    const ref = referral("alice", "bob", 5);
    const d = decision({
      candidateId: "bob",
      at: ref.createdAt,
      signalWithout: [{ referrerId: "alice", signalWithout: 0 }],
    });
    const res = admit([ref], obs([d]));
    expect(res.terms.map((t) => t.referralId)).toEqual([ref.id]);
  });

  test("a decision whose only scored referral is recused still counts once in r", () => {
    const ref = referral("alice", "bob", 1);
    const d = decision({ candidateId: "bob", outcome: "admitted", decidedBy: "alice" });
    const res = admit([ref], obs([d]));
    expect(res.terms).toEqual([]);
    expect(res.admitRate.inbound).toBeCloseTo(blended(1, 1), 12);
  });
});

describe("position", () => {
  test("share is monotone: an earlier position never has a smaller share, so a larger credit on an admit and a larger debit on a denial", () => {
    const judges = Array.from({ length: 12 }, (_, i) => `j${i + 1}`);
    const refs = judges.map((j, i) => referral(j, "bob", i + 1));
    const without = judges.map((j) => ({ referrerId: j, signalWithout: 10 }));
    const credits = (outcome: "admitted" | "denied") => {
      const res = admit(
        refs,
        obs([decision({ candidateId: "bob", outcome, at: day(60), signalWithout: without })]),
      );
      return refs.map((r) => res.terms.find((t) => t.referralId === r.id)?.credit as number);
    };
    const pos = referralPositions(refs, ADM);
    const shares = refs.map((r) => pos.get(r.id)?.share as number);
    for (let i = 1; i < refs.length; i++)
      expect(shares[i]).toBeLessThanOrEqual(shares[i - 1] as number);
    expect(shares[0]).toBe(1);
    expect(shares[shares.length - 1]).toBe(ADM.positionFloor);
    const gain = credits("admitted");
    const loss = credits("denied");
    for (let i = 1; i < refs.length; i++) {
      expect(gain[i]).toBeLessThanOrEqual(gain[i - 1] as number);
      expect(Math.abs(loss[i] as number)).toBeLessThanOrEqual(Math.abs(loss[i - 1] as number));
    }
    expect(gain[0]).toBeGreaterThan(gain[gain.length - 1] as number);
  });

  test("self-referrals and repeats take no position; ties share the average", () => {
    const self = referral("bob", "bob", 1);
    const first = referral("alice", "bob", 2);
    const repeat = referral("alice", "bob", 3);
    const tieA = referral("carol", "bob", 5);
    const tieB = referral("dan", "bob", 5);
    const pos = referralPositions([self, first, repeat, tieA, tieB], ADM);
    expect(pos.has(self.id)).toBe(false);
    expect(pos.has(repeat.id)).toBe(false);
    expect(pos.get(first.id)?.position).toBe(1);
    expect(pos.get(tieA.id)?.position).toBe(2.5);
    expect(pos.get(tieB.id)?.position).toBe(2.5);
    expect(pos.get(tieA.id)?.share).toBe(pos.get(tieB.id)?.share as number);
    const flipped = referralPositions([tieB, tieA, first], ADM);
    expect(flipped.get(tieA.id)?.share).toBe(pos.get(tieA.id)?.share as number);
  });
});

function club(): ClubState {
  const s = emptyState(day(0).toISOString());
  const row = (id: string): ClubState["people"][number] => ({
    id,
    name: id,
    status: "candidate",
    reviewStatus: "new",
    createdAt: s.now,
    updatedAt: s.now,
  });
  s.people.push(row("alice"), row("carol"), row("bob"), row("rec"));
  return s;
}

const RATINGS = {
  conviction: 4,
  confidence: 4,
  relationshipDepth: 4,
  evidenceType: "firsthand_work",
  evidenceText: "Seen it.",
} as const;

function refer(
  s: ClubState,
  from: string,
  to: string,
  extra: { recognition?: ReferralRecognition } = {},
) {
  const r = addReferral(s, { referrerId: from, candidateId: to, ...RATINGS, ...extra });
  expect(r.error).toBeUndefined();
  return r.state;
}

function calibrate(s: ClubState, now = NOW) {
  const people = s.people.map((p) => person(p.id));
  return computeJudgeCalibration({
    people,
    referrals: s.referrals.map(clubToReferral),
    outcomes: [],
    now,
    spec: SPEC,
    admission: admissionObservations(s),
  });
}

describe("recognition answer, calls, recruiters", () => {
  test("a recognition answer is stored and never changes any weight", () => {
    const run = (recognition?: ReferralRecognition) => {
      let s = club();
      s = refer(s, "alice", "bob", recognition ? { recognition } : {});
      s = refer(s, "carol", "bob", recognition ? { recognition } : {});
      s = decide(s, "bob", "admit").state;
      return { s, run: calibrate(s) };
    };
    const base = run();
    for (const answer of ["not_yet", "soon", "yes", "not_sure"] as const) {
      const other = run(answer);
      expect(other.s.referrals.every((r) => r.recognition === answer)).toBe(true);
      expect([...other.run.estimates.values()]).toEqual([...base.run.estimates.values()]);
      expect([...(other.run.admission?.terms ?? [])].map((t) => t.credit)).toEqual(
        (base.run.admission?.terms ?? []).map((t) => t.credit),
      );
    }
  });

  test("a maybe takes no position and no stake; a hard no is stored, not scored", () => {
    let s = club();
    s = refer(s, "alice", "bob");
    const before = calibrate(decide(s, "bob", "admit").state);

    for (const outcome of ["maybe", "no"] as const) {
      const called = addCall(s, { candidateId: "bob", callerId: "carol", order: 1, outcome });
      expect(called.error).toBeUndefined();
      expect(called.state.calls).toHaveLength(1);
      expect(called.state.calls[0]?.outcome).toBe(outcome);
      expect(called.state.referrals).toHaveLength(s.referrals.length);
      const after = calibrate(decide(called.state, "bob", "admit").state);
      expect(after.estimates.get("carol")?.weight).toBe(0.3);
      expect(after.estimates.get("carol")?.admissionCredit).toBe(0);
      expect(after.admission?.sumByJudge.has("carol")).toBe(false);
      expect(after.estimates.get("alice")).toEqual(before.estimates.get("alice") as never);
    }
  });

  test("a yes takes the next open position and is an interview referral", () => {
    let s = club();
    s = refer(s, "alice", "bob");
    s = { ...s, now: day(1).toISOString() };
    const yes = addCall(s, {
      candidateId: "bob",
      callerId: "carol",
      order: 1,
      outcome: "yes",
      referral: RATINGS,
    });
    expect(yes.error).toBeUndefined();
    const row = yes.state.referrals.find((r) => r.referrerId === "carol");
    expect(row?.origin).toBe("interview");
    const pos = referralPositions(yes.state.referrals.map(clubToReferral), ADM);
    expect(pos.get(row?.id as string)?.position).toBe(2);
  });

  test("a yes from a caller who already has a referral stores the call and adds no second referral", () => {
    const outcomeOf = (s: ClubState) => {
      const run = calibrate(decide({ ...s, now: day(30).toISOString() }, "bob", "admit").state);
      return {
        positions: [...(run.admission?.positions.values() ?? [])],
        credit: run.admission?.terms.map((t) => [t.judgeId, t.credit]),
      };
    };
    const yesBy = (s: ClubState, callerId: string, order: 1 | 2) =>
      addCall(s, { candidateId: "bob", callerId, order, outcome: "yes", referral: RATINGS });

    const s = { ...refer(club(), "alice", "bob"), now: day(1).toISOString() };
    const inbound = yesBy(s, "alice", 1);
    expect(inbound.error).toBeUndefined();
    expect(inbound.state.calls).toHaveLength(1);
    expect(inbound.state.calls[0]).toMatchObject({ callerId: "alice", order: 1, outcome: "yes" });
    expect(inbound.state.referrals).toHaveLength(s.referrals.length);
    expect(outcomeOf(inbound.state)).toEqual(outcomeOf(s));

    const first = yesBy(s, "carol", 1);
    expect(first.error).toBeUndefined();
    const second = yesBy(first.state, "carol", 2);
    expect(second.error).toBeUndefined();
    expect(second.state.calls.map((c) => [c.order, c.outcome])).toEqual([
      [1, "yes"],
      [2, "yes"],
    ]);
    expect(second.state.referrals.filter((r) => r.referrerId === "carol")).toHaveLength(1);
    expect(outcomeOf(second.state)).toEqual(outcomeOf(first.state));
  });

  test("a recruiter never gains or loses weight, whether the candidate is admitted or denied", () => {
    for (const verdict of ["admit", "deny"] as const) {
      const selected = addPerson(club(), { name: "Dee", channel: "outbound" });
      expect(selected.error).toBeUndefined();
      const dee = selected.state.people.find((p) => p.name === "Dee")?.id as string;
      let s = { ...selected.state, now: day(1).toISOString() };
      const yes = addCall(s, {
        candidateId: dee,
        callerId: "carol",
        order: 1,
        outcome: "yes",
        referral: RATINGS,
      });
      expect(yes.error).toBeUndefined();
      s = { ...yes.state, now: day(30).toISOString() };
      const run = calibrate(decide(s, dee, verdict, undefined, { decidedBy: "rec" }).state);

      expect(run.admission?.positions.size).toBe(1);
      expect([...(run.admission?.positions.values() ?? [])][0]).toMatchObject({
        judgeId: "carol",
        position: 1,
      });
      expect(run.admission?.terms.map((t) => t.judgeId)).toEqual(["carol"]);
      const carol = run.admission?.terms[0];
      expect(carol?.reliance).toBe(1);
      expect(carol?.credit).toBe(0);
      expect(run.estimates.get("rec")?.weight).toBe(0.3);
      expect(run.estimates.get("rec")?.admissionCredit).toBe(0);
      expect(run.admission?.sumByJudge.has("rec")).toBe(false);
    }
  });
});

describe("member referrals and interview yeses rank on every channel", () => {
  type Step = { by: string; at: number; as: "referral" | "legacy" | "yes" };

  function council(channel: Channel, steps: Step[], verdict: "admit" | "deny" = "admit") {
    const added = addPerson(club(), { name: "Dee", channel });
    expect(added.error).toBeUndefined();
    const dee = added.state.people.find((p) => p.name === "Dee")?.id as string;
    let s = added.state;
    let order: 1 | 2 = 1;
    for (const step of steps) {
      s = { ...s, now: day(step.at).toISOString() };
      const res =
        step.as === "yes"
          ? addCall(s, {
              candidateId: dee,
              callerId: step.by,
              order,
              outcome: "yes",
              referral: RATINGS,
            })
          : addReferral(s, {
              referrerId: step.by,
              candidateId: dee,
              ...RATINGS,
              ...(step.as === "referral" ? { origin: "referral" as const } : {}),
            });
      expect(res.error).toBeUndefined();
      if (step.as === "yes") order = 2;
      s = res.state;
    }
    s = { ...s, now: day(30).toISOString() };
    const decided = decide(s, dee, verdict, undefined, { decidedBy: "rec" }).state;
    const run = calibrate(decided);
    const positions = [...(run.admission?.positions.values() ?? [])];
    return {
      state: decided,
      positions,
      position: (judgeId: string) => positions.find((p) => p.judgeId === judgeId),
      terms: run.admission?.terms ?? [],
    };
  }

  test("a member referral before the interview yes takes position 1, the yes position 2, and both earn credit", () => {
    for (const channel of ["outbound", "inbound"] as const) {
      for (const as of ["referral", "legacy"] as const) {
        const r = council(channel, [
          { by: "alice", at: 1, as },
          { by: "carol", at: 2, as: "yes" },
        ]);
        expect(r.position("alice")).toMatchObject({ position: 1, share: positionShare(1, ADM) });
        expect(r.position("carol")).toMatchObject({ position: 2, share: positionShare(2, ADM) });
        expect(r.terms.map((t) => t.judgeId)).toEqual(["alice", "carol"]);
        for (const t of r.terms) {
          expect(t.share).toBe(r.position(t.judgeId)?.share as number);
          expect(t.credit).toBeCloseTo(ADM.kappa * t.share * (1 - t.reliance), 12);
          expect(t.credit).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("history and old documents", () => {
  test("a reopen or reversal after the first council decision changes nothing", () => {
    let s = club();
    s = refer(s, "alice", "bob");
    s = refer(s, "carol", "bob");
    s = { ...s, now: day(30).toISOString() };
    s = decide(s, "bob", "admit").state;
    const oneDecision = calibrate(s, day(300));

    s = { ...s, now: day(60).toISOString() };
    s = decide(s, "bob", "reopen").state;
    s = { ...s, now: day(90).toISOString() };
    s = decide(s, "bob", "deny").state;
    const history = calibrate(s, day(300));

    expect(admissionObservations(s).decisions.filter((d) => d.candidateId === "bob")).toHaveLength(
      2,
    );
    expect(history.admission?.terms).toEqual(oneDecision.admission?.terms as never);
    expect([...history.estimates.values()]).toEqual([...oneDecision.estimates.values()]);
    expect(history.admission?.terms.every((t) => t.decision === "admitted")).toBe(true);
  });

  test("a decision snapshot records decidedBy and the signal without each referrer", () => {
    let s = club();
    s = refer(s, "alice", "bob");
    s = refer(s, "carol", "bob");
    const done = decide(s, "bob", "admit", undefined, { decidedBy: "rec" });
    const snap = done.state.snapshots[0];
    expect(snap?.decidedBy).toBe("rec");
    expect(snap?.signalWithout?.map((x) => x.referrerId).sort()).toEqual(["alice", "carol"]);
  });

  test("snapshots and referrals written before these fields still load and score nothing", () => {
    let s = club();
    s = refer(s, "alice", "bob");
    s = decide(s, "bob", "deny").state;
    const old = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    delete old.calls;
    for (const snap of old.snapshots as Record<string, unknown>[]) {
      delete snap.decidedBy;
      delete snap.signalWithout;
    }
    for (const p of old.people as Record<string, unknown>[]) delete p.channel;
    for (const r of old.referrals as Record<string, unknown>[]) {
      delete r.origin;
      delete r.recognition;
    }
    const revived = reviveState(old as unknown as ClubState);
    expect(revived.calls).toEqual([]);
    expect(revived.snapshots).toHaveLength(1);
    const run = calibrate(revived);
    expect(run.admission?.terms).toEqual([]);
    expect(run.estimates.get("alice")?.weight).toBe(0.3);
  });

  test("every new Convex field is optional, so old documents stay valid", () => {
    type Field = { isOptional: string };
    const fields = (table: string) =>
      (
        schema.tables as unknown as Record<string, { validator: { fields: Record<string, Field> } }>
      )[table]?.validator.fields as Record<string, Field>;
    expect(fields("clubPeople").channel?.isOptional).toBe("optional");
    expect(fields("clubReferrals").origin?.isOptional).toBe("optional");
    expect(fields("clubReferrals").recognition?.isOptional).toBe("optional");
    expect(fields("clubSnapshots").decidedBy?.isOptional).toBe("optional");
    expect(fields("clubSnapshots").signalWithout?.isOptional).toBe("optional");
  });
});
