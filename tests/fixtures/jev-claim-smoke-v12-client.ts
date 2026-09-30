import type { V12JevClient } from "../../scripts/jev-claim-smoke-v12.ts";
import type { ClaimRubricV12Request } from "../../src/longitudinal/claimRubricV12.ts";

type RoleName = "original_author" | "major_contributor" | "maintainer" | "minor_part";

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

function classBlock(choice: "selection" | "output", confidence = 0.92) {
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

function roleBlock(choice: RoleName) {
  return {
    choice,
    confidence: 0.9,
    probabilities: {
      original_author: choice === "original_author" ? 1 : 0,
      major_contributor: choice === "major_contributor" ? 1 : 0,
      maintainer: choice === "maintainer" ? 1 : 0,
      minor_part: choice === "minor_part" ? 1 : 0,
    },
  };
}

export function fixtureAnswers(request: ClaimRubricV12Request): unknown {
  const text = request.state.text;
  if (!("selectivity" in request.questions) && !("difficulty" in request.questions)) {
    if (/selected|1 of \d+/i.test(text)) return { claim_class: classBlock("selection") };
    return { claim_class: classBlock("output") };
  }
  if ("selectivity" in request.questions) {
    const pool = /one school/i.test(text) ? 1 : /national/i.test(text) ? 3 : 2;
    return {
      claim_class: classBlock("selection"),
      selectivity: level(4),
      pool_strength: level(pool),
    };
  }
  const role: RoleName = /maintained/i.test(text)
    ? "maintainer"
    : /kept the notes/i.test(text)
      ? "minor_part"
      : "major_contributor";
  const difficulty = /roster alpha/i.test(text) ? 3 : /roster beta/i.test(text) ? 1 : 2;
  const scale = /roster beta/i.test(text) ? 2 : 1;
  const scaleConfidence = /designed the lamp/i.test(text) ? 0.2 : 0.9;
  return {
    claim_class: classBlock("output"),
    difficulty: level(difficulty),
    scale: level(scale, scaleConfidence),
    role: roleBlock(role),
  };
}

export function fixtureV12Client(): V12JevClient {
  return {
    systemOne(request) {
      return {
        async withResponse() {
          return { data: { model: "fixture-v12", answers: fixtureAnswers(request) } };
        },
      };
    },
  };
}
