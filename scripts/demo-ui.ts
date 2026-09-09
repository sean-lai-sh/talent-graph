#!/usr/bin/env bun
/**
 * bun run demo:ui — serves the interactive judge-calibration explainer.
 *
 * Frames are computed once from the seed through the real V2 path
 * (`buildJudgeTimeline` → `computeJudgeCalibration`). The HTTP layer
 * only serves those frames plus the static files in `demo/`.
 */

import { join, normalize, relative, resolve } from "node:path";
import {
  buildJudgeTimeline,
  DEMO_TIMELINE_END,
  DEMO_TIMELINE_START,
} from "../src/analysis/judgeTimeline.ts";
import { loadSpecs } from "../src/config.ts";
import { generateSeed } from "../src/seed/generate.ts";
import { PERSONA_IDS } from "../src/seed/personas.ts";

const DEMO_DIR = resolve(import.meta.dir, "../demo");
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "0.0.0.0";

const specs = loadSpecs();
const data = generateSeed();
const timeline = buildJudgeTimeline({
  people: data.people,
  referrals: data.referrals,
  outcomes: data.outcomes,
  opportunities: data.opportunities,
  start: DEMO_TIMELINE_START,
  end: DEMO_TIMELINE_END,
  spec: specs.judge_reliability,
  referralSpec: specs.referral_signal,
  personaIds: PERSONA_IDS,
});

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function contentType(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.slice(dot) : "";
  return TYPES[ext] ?? "application/octet-stream";
}

function safeDemoFile(pathname: string): string | null {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (relativePath.includes("\0") || relativePath.includes("..")) return null;
  const resolved = normalize(join(DEMO_DIR, relativePath));
  if (relative(DEMO_DIR, resolved).startsWith("..")) return null;
  return resolved;
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/timeline") {
      return Response.json(timeline, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const filePath = safeDemoFile(url.pathname);
    if (filePath === null) return new Response("Not found", { status: 404 });
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file, { headers: { "Content-Type": contentType(filePath) } });
  },
});

console.log(`Judge calibration explainer → http://127.0.0.1:${server.port}`);
console.log(
  `${timeline.frames.length} frames · ${timeline.edges.length} referrals · spec ${timeline.specVersion}`,
);
