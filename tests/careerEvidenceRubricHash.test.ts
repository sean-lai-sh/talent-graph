import { expect, test } from "bun:test";
import { type ClaimRubricRequest, scoreClaimRubric } from "../src/longitudinal/claimRubricV11.ts";
import {
  type ClaimRubricV12Request,
  scoreClaimRubricV12,
} from "../src/longitudinal/claimRubricV12.ts";
import { CAREER_EVIDENCE_V1_0_0, careerEvidenceRubricHash } from "../src/models/careerEvidence.ts";
import {
  CAREER_EVIDENCE_V1_1_0,
  careerEvidenceV11RubricHash,
} from "../src/models/careerEvidenceV11.ts";
import {
  CAREER_EVIDENCE_V1_2_0,
  CAREER_EVIDENCE_V1_2_1,
  careerEvidenceV12Behavior,
  careerEvidenceV12RubricHash,
} from "../src/models/careerEvidenceV12.ts";
import { SPEC_HISTORY } from "../src/models/registry.ts";
import type {
  CareerEvidenceSpec,
  CareerEvidenceV11Spec,
  CareerEvidenceV12Spec,
  ModelSpec,
} from "../src/models/spec.ts";
import { hashInputs } from "../src/provenance/hash.ts";

const JOB = [
  "Engineer at Harborline (Jan 2020 - Mar 2021)",
  "- Won the example prize",
  "- Built the kiosk for 40 club members",
].join("\n");

const FREE = "Selected as 1 of 400 applicants to the Northwind program.";

function level(score: number, confidence = 0.9) {
  return {
    score,
    confidence,
    probabilities: {
      0: score === 0 ? 1 : 0,
      1: score === 1 ? 1 : 0,
      2: score === 2 ? 1 : 0,
      3: score === 3 ? 1 : 0,
      4: score === 4 ? 1 : 0,
    },
  };
}

function classBlock(choice: "selection" | "output", confidence: number) {
  return {
    choice,
    confidence,
    probabilities: {
      selection: choice === "selection" ? 1 : 0,
      output: choice === "output" ? 1 : 0,
      both: 0,
    },
  };
}

function answerV12(request: ClaimRubricV12Request, classConfidence: number) {
  if (!("selectivity" in request.questions) && !("difficulty" in request.questions)) {
    return { claim_class: classBlock("selection", classConfidence) };
  }
  if ("selectivity" in request.questions) {
    return {
      claim_class: classBlock("selection", classConfidence),
      selectivity: level(4),
      pool_strength: level(2),
    };
  }
  return {
    claim_class: classBlock("output", classConfidence),
    difficulty: level(2),
    scale: level(1),
    role: {
      choice: "major_contributor" as const,
      confidence: 0.9,
      probabilities: {
        original_author: 0,
        major_contributor: 1,
        maintainer: 0,
        minor_part: 0,
      },
    },
  };
}

function answerV11(request: ClaimRubricRequest) {
  void request;
  return {
    claim_class: classBlock("selection", 0.2),
    selectivity: level(4),
    difficulty: level(2),
    generalized_impact: level(1),
    ownership: {
      choice: "supporting" as const,
      confidence: 0.9,
      probabilities: { led: 0, core_contributor: 0, supporting: 1 },
    },
  };
}

function keysOf(questions: object): string[] {
  return Object.keys(questions).sort();
}

/** What this version asks, and how a low class confidence becomes a status. */
function questionPlan(spec: ModelSpec): unknown {
  if (spec.kind !== "career_evidence") throw new Error(`not career evidence: ${spec.kind}`);
  if ("pool_strength" in spec) return v12Plan(spec);
  if ("selectivityCuts" in spec) return v11Plan(spec);
  return v10Plan(spec);
}

function v10Plan(spec: CareerEvidenceSpec) {
  return {
    family: "event",
    asks: {
      identity: ["identityDecision", "identity", "identityFields"],
      event: ["eventKind"],
      dimensions: Object.keys(spec.questions.dimensions).sort(),
    },
    classHandling: "none",
  };
}

function v11Plan(spec: CareerEvidenceV11Spec) {
  let asked: string[] = [];
  const claims = scoreClaimRubric(
    {
      statement: FREE,
      parentId: "free",
      source: "resume",
      respond: (request) => {
        asked = keysOf(request.questions);
        return answerV11(request);
      },
    },
    spec,
  );
  const claim = claims[0];
  if (!claim) throw new Error("1.1.0 scored nothing");
  return {
    family: "claim",
    asks: { line: asked },
    classHandling: {
      asked: asked.includes("claim_class"),
      lowConfidenceReviews: claim.reviewReasons.includes("class_low_confidence"),
      classConfidence: claim.classConfidence,
    },
  };
}

function v12Plan(spec: CareerEvidenceV12Spec) {
  const datedRequests: ClaimRubricV12Request[] = [];
  const dated = scoreClaimRubricV12(
    {
      lines: [{ id: "job", statement: JOB, publishedAt: null }],
      source: "resume",
      respond: (request) => {
        datedRequests.push(request);
        return answerV12(request, 0.2);
      },
    },
    spec,
  );
  const hire = dated.find((claim) => claim.id === "job#hire");
  const output = dated.find((claim) => claim.text === "Built the kiosk for 40 club members");
  const hireRequest = datedRequests.find((request) =>
    request.state.text.startsWith("Engineer at Harborline"),
  );
  const outputRequest = datedRequests.find(
    (request) => request.state.text === "Built the kiosk for 40 club members",
  );
  if (!hire || !output || !hireRequest || !outputRequest) {
    throw new Error("expected a dated hire and a dated output");
  }

  const freeRequests: ClaimRubricV12Request[] = [];
  const free = scoreClaimRubricV12(
    {
      lines: [{ id: "free", statement: FREE, publishedAt: null }],
      source: "resume",
      respond: (request) => {
        freeRequests.push(request);
        return answerV12(request, 0.2);
      },
    },
    spec,
  );
  const freeClaim = free[0];
  const probe = freeRequests.find(
    (request) => !("selectivity" in request.questions) && !("difficulty" in request.questions),
  );
  const scored = freeRequests.find((request) => "selectivity" in request.questions);
  if (!freeClaim || !probe || !scored)
    throw new Error("expected a free-line class probe and score");

  return {
    family: "claim",
    asks: {
      datedSelection: keysOf(hireRequest.questions),
      datedOutput: keysOf(outputRequest.questions),
      freeProbe: keysOf(probe.questions),
      freeScore: keysOf(scored.questions),
    },
    classHandling: {
      datedClassConfidence: hire.classConfidence,
      datedLowConfidenceReviews: hire.reviewReasons.includes("class_low_confidence"),
      freeClassConfidence: freeClaim.classConfidence,
      freeLowConfidenceReviews: freeClaim.reviewReasons.includes("class_low_confidence"),
    },
  };
}

function rubricHash(spec: ModelSpec): string {
  if (spec.kind !== "career_evidence") throw new Error(`not career evidence: ${spec.kind}`);
  if ("pool_strength" in spec) return careerEvidenceV12RubricHash(spec);
  if ("selectivityCuts" in spec) return careerEvidenceV11RubricHash(spec);
  return careerEvidenceRubricHash(spec);
}

test("career_evidence@1.2.0 and career_evidence@1.2.1 rubric hashes differ", () => {
  expect(careerEvidenceV12RubricHash(CAREER_EVIDENCE_V1_2_0)).not.toBe(
    careerEvidenceV12RubricHash(CAREER_EVIDENCE_V1_2_1),
  );
});

test("the rubric hash is the serialized ask", () => {
  for (const spec of [CAREER_EVIDENCE_V1_2_0, CAREER_EVIDENCE_V1_2_1]) {
    const behavior = careerEvidenceV12Behavior(spec);
    const observed = v12Plan(spec);
    expect(careerEvidenceV12RubricHash(spec)).toBe(hashInputs(behavior));
    expect([...behavior.questionPlan.dated.selection].sort()).toEqual(observed.asks.datedSelection);
    expect([...behavior.questionPlan.dated.output].sort()).toEqual(observed.asks.datedOutput);
    expect([...behavior.questionPlan.free.probe].sort()).toEqual(observed.asks.freeProbe);
    expect([...behavior.questionPlan.free.selection].sort()).toEqual(observed.asks.freeScore);
    expect(behavior.questionPlan.dated.classHandling).toEqual(
      observed.classHandling.datedClassConfidence === 1
        ? { source: "structural", confidence: 1, classGate: "skip" }
        : { source: "model", classGate: "apply" },
    );
    expect(behavior.questionPlan.free.classHandling).toEqual({
      source: "model",
      classGate: "apply",
    });
    expect(observed.classHandling.freeLowConfidenceReviews).toBe(true);
  }
});

test("registered career_evidence versions with different question plans do not share a hash", () => {
  const specs = SPEC_HISTORY.filter((spec) => spec.kind === "career_evidence");
  expect(specs.map((spec) => spec.version)).toEqual(["1.0.0", "1.1.0", "1.2.0", "1.2.1"]);
  expect(questionPlan(CAREER_EVIDENCE_V1_2_0)).not.toEqual(questionPlan(CAREER_EVIDENCE_V1_2_1));
  expect(questionPlan(CAREER_EVIDENCE_V1_0_0)).not.toEqual(questionPlan(CAREER_EVIDENCE_V1_1_0));

  for (let i = 0; i < specs.length; i++) {
    for (let j = i + 1; j < specs.length; j++) {
      const left = specs[i];
      const right = specs[j];
      if (!left || !right) continue;
      if (JSON.stringify(questionPlan(left)) === JSON.stringify(questionPlan(right))) continue;
      expect(rubricHash(left)).not.toBe(rubricHash(right));
    }
  }
});
