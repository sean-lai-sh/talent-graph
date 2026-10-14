// Loopback stand-in for Jev's POST /v1/systemone, with the same answers as FakeJev in
// tests/evidence-intake.test.ts. Every call is appended to the log as one JSON line.
import { appendFileSync } from "node:fs";

const port = Number(process.env.FAKE_JEV_PORT ?? 3320);
const log = process.env.FAKE_JEV_LOG ?? "fake-jev.jsonl";

const levelBlock = (score: number) => ({
  score,
  confidence: 0.9,
  probabilities: Object.fromEntries([0, 1, 2, 3, 4].map((i) => [i, i === score ? 1 : 0])),
  legend: Object.fromEntries([0, 1, 2, 3, 4].map((i) => [i, `level ${i}`])),
});
const classBlock = (choice: "selection" | "output") => ({
  choice,
  confidence: 0.9,
  probabilities: {
    selection: choice === "selection" ? 1 : 0,
    output: choice === "output" ? 1 : 0,
    both: 0,
  },
});
const level = (text: string) => (/ambitious/i.test(text) ? 4 : /toy/i.test(text) ? 1 : 2);

function answer(state: Record<string, unknown>, questions: Record<string, unknown>) {
  if (Object.keys(questions).some((key) => key.startsWith("line_"))) {
    const lines = state.lines as string[];
    return {
      kind: "label",
      answers: Object.fromEntries(
        lines.map((line, offset) => {
          const text = line.replace(/^\d+: /, "");
          const role = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text)
            ? "dates"
            : /intern|engineer|assistant/i.test(text) && text.length < 40
              ? "job_title"
              : /corp|inc|lab/i.test(text) && text.length < 40
                ? "organization"
                : "bullet";
          return [`line_${offset}`, { choice: role, confidence: 1, probabilities: {} }];
        }),
      ),
    };
  }
  const text = String(state.text);
  const score = level(text);
  if ("selectivity" in questions) {
    return {
      kind: "claim",
      text,
      answers: {
        claim_class: classBlock("selection"),
        selectivity: levelBlock(3),
        pool_strength: levelBlock(2),
      },
    };
  }
  if ("difficulty" in questions) {
    return {
      kind: "claim",
      text,
      answers: {
        claim_class: classBlock("output"),
        difficulty: levelBlock(score),
        scale: levelBlock(score),
        role: {
          choice: "major_contributor",
          confidence: 0.9,
          probabilities: { original_author: 0, major_contributor: 1, maintainer: 0, minor_part: 0 },
        },
      },
    };
  }
  return { kind: "claim", text, answers: { claim_class: classBlock("output") } };
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/systemone") {
      return new Response("not found", { status: 404 });
    }
    const body = (await request.json()) as {
      state: Record<string, unknown>;
      questions: Record<string, unknown>;
    };
    const { kind, text, answers } = answer(body.state, body.questions);
    appendFileSync(
      log,
      `${JSON.stringify({ at: new Date().toISOString(), kind, text: text ?? null })}\n`,
    );
    return Response.json(
      { model: "fake-jev-local", answers, usage: { input_tokens: 10, output_tokens: 5 } },
      { headers: { "x-request-id": `fake-${Date.now()}` } },
    );
  },
});
console.log(`fake jev on http://127.0.0.1:${port}`);
