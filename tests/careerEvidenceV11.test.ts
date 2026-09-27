/**
 * `career_evidence@1.1.0` scores a claim as a selection or an output.
 *
 * The claims are synthetic. Northwind is not a real organization, and none of
 * the sentences are resume text. Responses are stubs. Nothing calls Jev.
 */

import { describe, expect, test } from "bun:test";
import { claimQuestionsV11 } from "../apps/club/lib/longitudinal/jevClient.ts";
import { type ClaimRubricRequest, scoreClaimRubric } from "../src/longitudinal/claimRubricV11.ts";
import { JudgmentInvariantError } from "../src/longitudinal/records.ts";
import {
  CAREER_EVIDENCE_V1_1_0,
  careerEvidenceV11RubricHash,
  careerEvidenceV11SpecId,
  selectivityLevelForRate,
} from "../src/models/careerEvidenceV11.ts";
import { CURRENT_SPECS, getSpec, isRegisteredSpec, specVersions } from "../src/models/registry.ts";
import { type CareerEvidenceV11Spec, validateSpec } from "../src/models/spec.ts";

const PINNED_RUBRIC_HASH = "60dadea6eae5cd8e3a0a552941ab30ef5cc12bde0f1346ab4d65ed6a78ab689c";

const spec = CAREER_EVIDENCE_V1_1_0;

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

function answer(options: {
  choice: "selection" | "output" | "both";
  classConfidence?: number;
  probabilities?: { selection: number; output: number; both: number };
  selectivity?: { score: number; confidence: number };
  difficulty?: { score: number; confidence: number };
  impact?: { score: number; confidence: number };
  ownershipChoice?: "led" | "core_contributor" | "supporting";
  ownershipConfidence?: number;
}) {
  const choice = options.choice;
  const probabilities = options.probabilities ?? {
    selection: choice === "selection" ? 1 : 0,
    output: choice === "output" ? 1 : 0,
    both: choice === "both" ? 1 : 0,
  };
  const ownershipChoice = options.ownershipChoice ?? "supporting";
  const selectivity = options.selectivity ?? { score: 4, confidence: 0.9 };
  const difficulty = options.difficulty ?? { score: 3, confidence: 0.9 };
  const impact = options.impact ?? { score: 2, confidence: 0.9 };
  return {
    claim_class: {
      choice,
      confidence: options.classConfidence ?? 0.92,
      probabilities,
    },
    selectivity: level(selectivity.score, selectivity.confidence),
    difficulty: level(difficulty.score, difficulty.confidence),
    generalized_impact: level(impact.score, impact.confidence),
    ownership: {
      choice: ownershipChoice,
      confidence: options.ownershipConfidence ?? 0.8,
      probabilities: {
        led: ownershipChoice === "led" ? 1 : 0,
        core_contributor: ownershipChoice === "core_contributor" ? 1 : 0,
        supporting: ownershipChoice === "supporting" ? 1 : 0,
      },
    },
  };
}

function score(
  statement: string,
  respond: (request: ClaimRubricRequest) => unknown,
  source: "resume" | "github" = "resume",
  parentId = "parent",
) {
  return scoreClaimRubric({ statement, parentId, source, respond });
}

describe("career_evidence@1.1.0 registration", () => {
  test("1.1.0 is registered and 1.0.0 stays current", () => {
    expect(validateSpec(spec)).toEqual({ ok: true });
    expect(isRegisteredSpec(spec)).toBe(true);
    expect(specVersions("career_evidence")).toEqual(["1.0.0", "1.1.0"]);
    expect(getSpec("career_evidence", "1.0.0").version).toBe("1.0.0");
    expect(getSpec("career_evidence", "1.1.0").version).toBe("1.1.0");
    expect(CURRENT_SPECS.career_evidence.version).toBe("1.0.0");
  });

  test("the rubric hash is pinned, and a level edit changes it without moving the version", () => {
    expect(careerEvidenceV11RubricHash(spec)).toBe(PINNED_RUBRIC_HASH);
    expect(careerEvidenceV11SpecId(spec)).toBe(
      `career_evidence@1.1.0:${PINNED_RUBRIC_HASH.slice(0, 8)}`,
    );
    const edited = structuredClone(spec) as CareerEvidenceV11Spec;
    const levels = edited.selectivity.levels as unknown as string[];
    const original = levels[4] as string;
    levels[4] = `${original} extra`;
    expect(careerEvidenceV11RubricHash(edited)).not.toBe(PINNED_RUBRIC_HASH);
    expect(edited.version).toBe("1.1.0");
  });

  test("a thresholds-only edit does not change the rubric hash", () => {
    const edited = structuredClone(spec) as CareerEvidenceV11Spec;
    edited.thresholds = { classConfidence: 0.9, dimensionConfidence: 0.8 };
    expect(careerEvidenceV11RubricHash(edited)).toBe(PINNED_RUBRIC_HASH);
  });

  test("a 1.1.0 spec missing selectivity does not validate", () => {
    const broken = structuredClone(spec) as CareerEvidenceV11Spec;
    delete (broken as { selectivity?: unknown }).selectivity;
    const result = validateSpec(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("selectivity");
  });
});

describe("selectivity anchors", () => {
  test("inclusive cuts map a rate to a level, and the prompt states those cuts", () => {
    expect(selectivityLevelForRate(0.01)).toBe(4);
    expect(selectivityLevelForRate(0.02)).toBe(3);
    expect(selectivityLevelForRate(0.05)).toBe(3);
    expect(selectivityLevelForRate(0.06)).toBe(2);
    expect(selectivityLevelForRate(0.2)).toBe(2);
    expect(selectivityLevelForRate(0.21)).toBe(1);
    expect(selectivityLevelForRate(0.5)).toBe(1);
    expect(selectivityLevelForRate(0.51)).toBe(0);
    expect(() => selectivityLevelForRate(-0.01)).toThrow("selection rate");

    for (const cut of spec.selectivityCuts) {
      const percent = cut.maxRate * 100;
      expect(spec.selectivity.question.includes(cut.maxRate.toFixed(2))).toBe(true);
      expect(
        spec.selectivity.levels[cut.level]?.toLowerCase().includes(`at most ${percent}%`),
      ).toBe(true);
    }
  });

  test("a parsed rate is on the prompt, including a pool that is only a lower bound", () => {
    const seen: ClaimRubricRequest[] = [];
    score("Selected as 1 of 400 applicants to the Northwind program.", (request) => {
      seen.push(request);
      return answer({ choice: "selection" });
    });
    expect(seen[0]?.state.selection_rate).toBe(1 / 400);
    expect(seen[0]?.state.selection_rate_upper_bound).toBe(false);
    expect(selectivityLevelForRate(seen[0]?.state.selection_rate ?? -1)).toBe(4);

    seen.length = 0;
    score("Selected as 1 of 400+ applicants to the Northwind program.", (request) => {
      seen.push(request);
      return answer({ choice: "selection" });
    });
    expect(seen[0]?.state.selection_rate).toBe(1 / 400);
    expect(seen[0]?.state.selection_rate_upper_bound).toBe(true);
  });
});

describe("class scoring", () => {
  test("a pure selection is one claim, and resume scoring does not ask peer validation", () => {
    for (const source of ["resume", "github"] as const) {
      const seen: ClaimRubricRequest[] = [];
      const claims = score(
        "Admitted to the Northwind fellowship.",
        (request) => {
          seen.push(request);
          return answer({ choice: "selection", ownershipChoice: "supporting" });
        },
        source,
        "northwind-fellow",
      );
      expect(Object.keys(seen[0]?.questions ?? {})).toEqual([
        "claim_class",
        "selectivity",
        "difficulty",
        "generalized_impact",
        "ownership",
      ]);
      expect(claims).toEqual([
        {
          id: "northwind-fellow",
          parentId: "northwind-fellow",
          text: "Admitted to the Northwind fellowship.",
          statement: "Admitted to the Northwind fellowship.",
          claimClass: "selection",
          classProbabilities: { selection: 1, output: 0, both: 0 },
          classConfidence: 0.92,
          selectivity: { score: 4, confidence: 0.9, probabilities: [0, 0, 0, 0, 1] },
          ownership: {
            choice: "supporting",
            confidence: 0.8,
            probabilities: { led: 0, core_contributor: 0, supporting: 1 },
          },
          ownershipSeed: null,
          status: "accepted",
          reviewReasons: [],
          rubricId: "career_evidence@1.1.0",
          rubricHash: PINNED_RUBRIC_HASH,
        },
      ]);
    }
  });

  test("a pure output keeps the verb tier as a seed and the model's ownership distribution", () => {
    const seen: ClaimRubricRequest[] = [];
    const claims = score(
      "Built the Northwind routing service for three transit agencies.",
      (request) => {
        seen.push(request);
        return answer({
          choice: "output",
          ownershipChoice: "supporting",
          ownershipConfidence: 0.2,
        });
      },
    );
    expect(seen[0]?.state.ownership_seed).toBe("core_contributor");
    expect(claims[0]?.claimClass).toBe("output");
    expect(claims[0]?.ownershipSeed).toBe("core_contributor");
    expect(claims[0]?.ownership).toEqual({
      choice: "supporting",
      confidence: 0.2,
      probabilities: { led: 0, core_contributor: 0, supporting: 1 },
    });
    expect(claims[0]?.status).toBe("accepted");
    if (claims[0]?.claimClass === "output") {
      expect(claims[0].difficulty).toEqual({
        score: 3,
        confidence: 0.9,
        probabilities: [0, 0, 0, 1, 0],
      });
      expect(claims[0].generalized_impact).toEqual({
        score: 2,
        confidence: 0.9,
        probabilities: [0, 0, 1, 0, 0],
      });
    }
  });

  test("led and contributed verbs seed the matching ownership tiers", () => {
    const led = score("Led the Northwind desk for two years.", () =>
      answer({ choice: "output", ownershipChoice: "led" }),
    );
    const helped = score("Helped the Northwind crew run the annual fair.", () =>
      answer({ choice: "output", ownershipChoice: "supporting" }),
    );
    expect(led[0]?.ownershipSeed).toBe("led");
    expect(helped[0]?.ownershipSeed).toBe("supporting");
  });

  test("a mixed claim the splitter left whole comes back as two linked claims", () => {
    const statement = "Won 1 of 400 with the Northwind routing service behind it.";
    let calls = 0;
    const claims = score(
      statement,
      () => {
        calls += 1;
        return answer({
          choice: "both",
          classConfidence: 0.88,
          probabilities: { selection: 0.2, output: 0.1, both: 0.7 },
        });
      },
      "resume",
      "northwind-win",
    );
    expect(calls).toBe(1);
    expect(claims.map((claim) => [claim.id, claim.parentId, claim.claimClass])).toEqual([
      ["northwind-win#selection", "northwind-win", "selection"],
      ["northwind-win#output", "northwind-win", "output"],
    ]);
    expect(claims.every((claim) => claim.text === statement)).toBe(true);
    expect(claims.every((claim) => claim.classConfidence === 0.88)).toBe(true);
    expect(claims.every((claim) => claim.rubricId === "career_evidence@1.1.0")).toBe(true);
    expect(claims.every((claim) => claim.rubricHash === PINNED_RUBRIC_HASH)).toBe(true);
    expect(claims[0]?.classProbabilities).toEqual({ selection: 0.2, output: 0.1, both: 0.7 });
    expect(claims[0]?.claimClass === "selection" && "selectivity" in claims[0]).toBe(true);
    expect(claims[1]?.claimClass === "output" && "generalized_impact" in claims[1]).toBe(true);
  });

  test("the splitter divides a bullet before the model is asked, and a later both does not divide it again", () => {
    const statement = "Built the Northwind router; selected as 1 of 400 applicants.";
    let calls = 0;
    const claims = score(
      statement,
      (request) => {
        calls += 1;
        const selection = request.state.selection_rate !== null;
        return answer({
          choice: "both",
          classConfidence: 0.8,
          probabilities: selection
            ? { selection: 0.55, output: 0.05, both: 0.4 }
            : { selection: 0.05, output: 0.55, both: 0.4 },
        });
      },
      "resume",
      "bullet",
    );
    expect(calls).toBe(2);
    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.id)).toEqual(["bullet#0", "bullet#1"]);
    expect(claims.map((claim) => claim.parentId)).toEqual(["bullet", "bullet"]);
    expect(claims.map((claim) => claim.text)).toEqual([
      "Built the Northwind router",
      "selected as 1 of 400 applicants.",
    ]);
    expect(claims.map((claim) => claim.claimClass)).toEqual(["output", "selection"]);
    expect(claims.map((claim) => claim.classConfidence)).toEqual([0.55, 0.55]);
    expect(claims[1]?.claimClass === "selection" && claims[1].selectivity.score).toBe(4);
  });

  test("a role title before the colon scores two halves when both is below the cutoff", () => {
    const statement =
      "Undergraduate Research Fellow at Northwind: Built the lab's parsing models to cut processing time by 25%";
    const selection = "Undergraduate Research Fellow at Northwind";
    const output = "Built the lab's parsing models to cut processing time by 25%";
    const seen: string[] = [];
    const claims = score(
      statement,
      (request) => {
        seen.push(request.state.text);
        if (request.state.text === statement) {
          return answer({
            choice: "both",
            classConfidence: 0.35,
            probabilities: { selection: 0.3, output: 0.35, both: 0.35 },
          });
        }
        if (request.state.text === selection) {
          return answer({ choice: "selection", classConfidence: 0.91 });
        }
        if (request.state.text === output) {
          return answer({
            choice: "output",
            classConfidence: 0.9,
            ownershipChoice: "core_contributor",
          });
        }
        throw new Error(`unexpected text ${request.state.text}`);
      },
      "resume",
      "fellow",
    );
    expect(seen).toEqual([statement, selection, output]);
    expect(claims.map((claim) => [claim.id, claim.claimClass, claim.text, claim.status])).toEqual([
      ["fellow#selection", "selection", selection, "accepted"],
      ["fellow#output", "output", output, "accepted"],
    ]);
    expect(claims.map((claim) => claim.reviewReasons)).toEqual([[], []]);
  });

  test("both below the class cutoff splits into halves and scores each half", () => {
    const statement = "Admitted to the Northwind fellowship and kept the lab notes.";
    const seen: string[] = [];
    const claims = score(
      statement,
      (request) => {
        seen.push(request.state.text);
        if (request.state.text === statement) {
          return answer({
            choice: "both",
            classConfidence: 0.32,
            probabilities: { selection: 0.4, output: 0.28, both: 0.32 },
          });
        }
        if (request.state.text === "Admitted to the Northwind fellowship") {
          return answer({ choice: "selection", classConfidence: 0.91 });
        }
        if (request.state.text === "kept the lab notes.") {
          return answer({ choice: "output", classConfidence: 0.87, ownershipChoice: "supporting" });
        }
        throw new Error(`unexpected text ${request.state.text}`);
      },
      "resume",
      "fellow",
    );
    expect(seen).toEqual([
      statement,
      "Admitted to the Northwind fellowship",
      "kept the lab notes.",
    ]);
    expect(claims.map((claim) => [claim.id, claim.claimClass, claim.text, claim.status])).toEqual([
      ["fellow#selection", "selection", "Admitted to the Northwind fellowship", "accepted"],
      ["fellow#output", "output", "kept the lab notes.", "accepted"],
    ]);
    expect(claims.map((claim) => claim.classConfidence)).toEqual([0.91, 0.87]);
    expect(claims.map((claim) => claim.reviewReasons)).toEqual([[], []]);
    expect(claims.every((claim) => claim.statement === statement)).toBe(true);
    expect(claims.every((claim) => claim.parentId === "fellow")).toBe(true);
  });

  test("both at the class cutoff keeps one response and the original text", () => {
    const statement = "Admitted to the Northwind fellowship and kept the lab notes.";
    let calls = 0;
    const claims = score(statement, () => {
      calls += 1;
      return answer({
        choice: "both",
        classConfidence: 0.65,
        probabilities: { selection: 0.2, output: 0.1, both: 0.7 },
      });
    });
    expect(calls).toBe(1);
    expect(claims.map((claim) => claim.text)).toEqual([statement, statement]);
    expect(claims.map((claim) => claim.status)).toEqual(["accepted", "accepted"]);
  });

  test("both below the cutoff with no separable half still reviews", () => {
    const statement = "Admitted to the Northwind fellowship.";
    const claims = score(statement, () =>
      answer({
        choice: "both",
        classConfidence: 0.32,
        probabilities: { selection: 0.4, output: 0.28, both: 0.32 },
      }),
    );
    expect(claims.map((claim) => claim.text)).toEqual([statement, statement]);
    expect(claims.map((claim) => claim.reviewReasons)).toEqual([
      ["class_low_confidence"],
      ["class_low_confidence"],
    ]);
  });
});

describe("class-aware review", () => {
  test("low class confidence reviews, and the boundary is the class threshold", () => {
    const low = score("Admitted to the Northwind fellowship.", () =>
      answer({ choice: "selection", classConfidence: 0.64 }),
    );
    const at = score("Admitted to the Northwind fellowship.", () =>
      answer({ choice: "selection", classConfidence: 0.65 }),
    );
    expect(low[0]?.status).toBe("review");
    expect(low[0]?.reviewReasons).toEqual(["class_low_confidence"]);
    expect(at[0]?.status).toBe("accepted");
    expect(at[0]?.reviewReasons).toEqual([]);
  });

  test("review uses the chosen class's dimensions and ignores the other class and ownership", () => {
    const selection = score("Admitted to the Northwind fellowship.", () =>
      answer({
        choice: "selection",
        selectivity: { score: 4, confidence: 0.49 },
        difficulty: { score: 1, confidence: 0.1 },
        ownershipConfidence: 0.1,
      }),
    );
    const selectionOk = score("Admitted to the Northwind fellowship.", () =>
      answer({
        choice: "selection",
        selectivity: { score: 4, confidence: 0.5 },
        difficulty: { score: 1, confidence: 0.1 },
        ownershipConfidence: 0.1,
      }),
    );
    const output = score("Built the Northwind routing service for three transit agencies.", () =>
      answer({
        choice: "output",
        impact: { score: 2, confidence: 0.49 },
        selectivity: { score: 0, confidence: 0.1 },
      }),
    );
    expect(selection[0]?.status).toBe("review");
    expect(selection[0]?.reviewReasons).toEqual(["dimension_low_confidence"]);
    expect(selectionOk[0]?.status).toBe("accepted");
    expect(output[0]?.status).toBe("review");
    expect(output[0]?.reviewReasons).toEqual(["dimension_low_confidence"]);
  });

  test("a response that is not the claim schema is refused", () => {
    expect(() => score("Admitted to the Northwind fellowship.", () => ({}))).toThrow(
      JudgmentInvariantError,
    );
  });
});

describe("the 1.1.0 prompt", () => {
  test("the SDK questions are the rubric text, in rubric order", () => {
    const questions = claimQuestionsV11(spec);
    expect(Object.keys(questions)).toEqual([
      "claim_class",
      "selectivity",
      "difficulty",
      "generalized_impact",
      "ownership",
    ]);
    expect(questions.claim_class.instructions).toBe(spec.claimClass.question);
    expect(questions.claim_class.criteria).toEqual({
      selection: spec.claimClass.selection,
      output: spec.claimClass.output,
      both: spec.claimClass.both,
    });
    expect(questions.selectivity.criteria).toEqual([...spec.selectivity.levels]);
    expect(questions.difficulty.instructions).toBe(spec.difficulty.question);
    expect(questions.generalized_impact.instructions).toBe(spec.generalized_impact.question);
    expect(questions.generalized_impact.criteria).toEqual([...spec.generalized_impact.levels]);
    expect(questions.ownership.criteria).toEqual({
      led: spec.ownership.led,
      core_contributor: spec.ownership.core_contributor,
      supporting: spec.ownership.supporting,
    });
  });
});
