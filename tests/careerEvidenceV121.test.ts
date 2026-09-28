import { expect, test } from "bun:test";
import { v12LiveQuestions } from "../scripts/jev-claim-smoke-v12.ts";
import {
  type ClaimRubricV12Request,
  scoreClaimRubricV12,
} from "../src/longitudinal/claimRubricV12.ts";
import { CAREER_EVIDENCE_V1_2_0, CAREER_EVIDENCE_V1_2_1 } from "../src/models/careerEvidenceV12.ts";
import { getSpec, specVersions } from "../src/models/registry.ts";

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

function classBlock(choice: "selection" | "output" | "both", confidence: number) {
  return {
    choice,
    confidence,
    probabilities: {
      selection: choice === "selection" ? 1 : 0,
      output: choice === "output" ? 1 : 0,
      both: choice === "both" ? 1 : 0,
    },
  };
}

function role(choice: "major_contributor") {
  return {
    choice,
    confidence: 0.9,
    probabilities: {
      original_author: 0,
      major_contributor: 1,
      maintainer: 0,
      minor_part: 0,
    },
  };
}

function respond(request: ClaimRubricV12Request, classConfidence: number) {
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
    role: role("major_contributor"),
  };
}

const JOB = [
  "Engineer at Harborline (Jan 2020 - Mar 2021)",
  "- Won the example prize",
  "- Built the kiosk for 40 club members",
].join("\n");

test("1.2.1 is registered beside 1.2.0 and keeps the same question text", () => {
  expect(specVersions("career_evidence")).toEqual([
    "1.0.0",
    "1.1.0",
    "1.2.0",
    "1.2.1",
    "1.2.2",
    "1.2.3",
  ]);
  expect(getSpec("career_evidence", "1.2.1").version).toBe("1.2.1");
  expect(CAREER_EVIDENCE_V1_2_1.claimClass).toEqual(CAREER_EVIDENCE_V1_2_0.claimClass);
  expect(CAREER_EVIDENCE_V1_2_1.selectivity).toEqual(CAREER_EVIDENCE_V1_2_0.selectivity);
});

test("a structural hire never reviews for class confidence, an award stays selection, and output scores stay", () => {
  const seen: ClaimRubricV12Request[] = [];
  const claims = scoreClaimRubricV12(
    {
      lines: [{ id: "job", statement: JOB, publishedAt: null }],
      source: "resume",
      respond: (request) => {
        seen.push(request);
        return respond(request, 0.2);
      },
    },
    CAREER_EVIDENCE_V1_2_1,
  );

  const hire = claims.find((claim) => claim.id === "job#hire");
  const award = claims.find((claim) => claim.text === "Won the example prize");
  const output = claims.find((claim) => claim.text === "Built the kiosk for 40 club members");
  const hireRequest = seen.find((request) =>
    request.state.text.startsWith("Engineer at Harborline"),
  );
  const awardRequest = seen.find((request) => request.state.text === "Won the example prize");
  const outputRequest = seen.find(
    (request) => request.state.text === "Built the kiosk for 40 club members",
  );
  if (!hire || !award || !output || !hireRequest || !awardRequest || !outputRequest) {
    throw new Error("expected a hire, an award, and an output");
  }

  expect(hire.claimClass).toBe("selection");
  expect(hire.reviewReasons).toEqual([]);
  expect(hire.status).toBe("accepted");
  expect(hire.classConfidence).toBe(1);
  expect("claim_class" in hireRequest.questions).toBe(false);
  expect("claim_class" in awardRequest.questions).toBe(false);
  expect("claim_class" in outputRequest.questions).toBe(false);
  expect(Object.keys(v12LiveQuestions(CAREER_EVIDENCE_V1_2_1, hireRequest))).toEqual([
    "selectivity",
    "pool_strength",
  ]);
  expect(Object.keys(v12LiveQuestions(CAREER_EVIDENCE_V1_2_1, outputRequest))).toEqual([
    "difficulty",
    "scale",
    "role",
  ]);

  expect(award.claimClass).toBe("selection");
  expect(award.status).toBe("accepted");
  expect(award.reviewReasons).toEqual([]);
  if (award.claimClass === "selection") {
    expect(award.selectivity.score).toBe(4);
    expect(award.pool_strength.score).toBe(2);
  }

  expect(output.claimClass).toBe("output");
  expect(output.status).toBe("accepted");
  expect(output.reviewReasons).toEqual([]);
  if (output.claimClass === "output") {
    expect(output.difficulty.score).toBe(2);
    expect(output.scale.score).toBe(1);
    expect(output.role.choice).toBe("major_contributor");
    expect(output.roleSeed).toBe("major_contributor");
  }
});

test("1.2.0 still reviews a structural hire when the model is unsure of class", () => {
  const seen: ClaimRubricV12Request[] = [];
  const claims = scoreClaimRubricV12(
    {
      lines: [{ id: "job", statement: JOB, publishedAt: null }],
      source: "resume",
      respond: (request) => {
        seen.push(request);
        return respond(request, 0.2);
      },
    },
    CAREER_EVIDENCE_V1_2_0,
  );
  const hire = claims.find((claim) => claim.id === "job#hire");
  const hireRequest = seen.find((request) =>
    request.state.text.startsWith("Engineer at Harborline"),
  );
  if (!hire || !hireRequest) throw new Error("expected the hire");
  expect("claim_class" in hireRequest.questions).toBe(true);
  expect(Object.keys(v12LiveQuestions(CAREER_EVIDENCE_V1_2_0, hireRequest))).toEqual([
    "claim_class",
    "selectivity",
    "pool_strength",
  ]);
  expect(hire.claimClass).toBe("selection");
  expect(hire.reviewReasons).toEqual(["class_low_confidence"]);
  expect(hire.status).toBe("review");
});

test("a free line on 1.2.1 still reviews when class confidence is low", () => {
  const claims = scoreClaimRubricV12(
    {
      lines: [
        {
          id: "free",
          statement: "Selected as 1 of 400 applicants to the Northwind program.",
          publishedAt: null,
        },
      ],
      source: "resume",
      respond: (request) => respond(request, 0.2),
    },
    CAREER_EVIDENCE_V1_2_1,
  );
  expect(claims.map((claim) => claim.claimClass)).toEqual(["selection"]);
  expect(claims.map((claim) => claim.reviewReasons)).toEqual([["class_low_confidence"]]);
  expect(claims.map((claim) => claim.status)).toEqual(["review"]);
});

test("a structural output with a low dimension still reviews only for that dimension", () => {
  const claims = scoreClaimRubricV12(
    {
      lines: [
        {
          id: "job",
          statement: "Engineer at Harborline (Jan 2020 - Mar 2021)\n- Built the kiosk",
          publishedAt: null,
        },
      ],
      source: "resume",
      respond: (request) => {
        if ("difficulty" in request.questions) {
          return {
            claim_class: classBlock("output", 0.2),
            difficulty: level(2),
            scale: level(1, 0.2),
            role: role("major_contributor"),
          };
        }
        return respond(request, 0.2);
      },
    },
    CAREER_EVIDENCE_V1_2_1,
  );
  const output = claims.find((claim) => claim.text === "Built the kiosk");
  if (output?.claimClass !== "output") throw new Error("expected the output");
  expect(output.difficulty.score).toBe(2);
  expect(output.scale.score).toBe(1);
  expect(output.scale.confidence).toBe(0.2);
  expect(output.reviewReasons).toEqual(["dimension_low_confidence"]);
  expect(output.status).toBe("review");
});
