import { expect, test } from "bun:test";
import {
  type ClaimRubricV12Request,
  scoreClaimRubricV12,
} from "../src/longitudinal/claimRubricV12.ts";

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

test("a structural hire never reviews for class confidence, an award stays selection, and output scores stay", () => {
  const seen: ClaimRubricV12Request[] = [];
  const claims = scoreClaimRubricV12({
    lines: [{ id: "job", statement: JOB, publishedAt: null }],
    source: "resume",
    respond: (request) => {
      seen.push(request);
      return respond(request, 0.2);
    },
  });

  const hire = claims.find((claim) => claim.id === "job#hire");
  const award = claims.find((claim) => claim.text === "Won the example prize");
  const output = claims.find((claim) => claim.text === "Built the kiosk for 40 club members");
  const hireRequest = seen.find((request) => request.state.text.startsWith("Engineer at Harborline"));
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
  }
});
