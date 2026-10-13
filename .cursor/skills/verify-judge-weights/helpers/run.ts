/**
 * One verification run. Launch first. Prints the pass/skip report.
 * Skipped engine checks are not counted as passes.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driveBrowser } from "./browser.ts";
import { checkAdmission, checkReferralSignal, checkSnapshots } from "./checks.ts";
import { type CheckResult, formatReport } from "./detect.ts";
import { scanMemberQueries } from "./queries.ts";

export async function executeRun(): Promise<number> {
  const skill = join(import.meta.dir, "..");
  const repo = join(skill, "../../..");
  const runId = readFileSync(join(skill, "runs/current"), "utf8").trim();
  const runDir = join(skill, "runs", runId);
  const evidence = join(skill, "evidence", runId);
  mkdirSync(evidence, { recursive: true });

  const appUrl = readFileSync(join(runDir, "app_url"), "utf8").trim();
  const convexUrl = readFileSync(join(runDir, "convex_url"), "utf8").trim();
  const mode = readFileSync(join(runDir, "mode"), "utf8").trim();
  const password = readFileSync(join(runDir, "password"), "utf8").trim();
  const memberEmail = "ada.quill@example.test";
  const adminEmail = "council.clerk@example.test";

  const lines: string[] = [];
  const say = (line: string) => {
    lines.push(line);
    console.log(line);
  };

  say(`verify-judge-weights run ${runId}`);
  say(`backend ${mode} ${convexUrl}`);
  say(`app ${appUrl}`);
  say("");

  const results: CheckResult[] = [];

  const gateDir = join(evidence, "admin-only");
  mkdirSync(gateDir, { recursive: true });
  try {
    const gate = await scanMemberQueries({
      repo,
      appUrl,
      convexUrl,
      email: memberEmail,
      password,
      adminEmail,
    });
    writeFileSync(join(gateDir, "member-payload-scan.json"), `${JSON.stringify(gate, null, 2)}\n`);
    if (gate.failures.length > 0) {
      results.push({
        id: "admin-only-weights",
        status: "fail",
        detail: gate.failures.join("; "),
      });
    } else {
      const browser = driveBrowser({
        appUrl,
        evidence,
        email: memberEmail,
        adminEmail,
        password,
      });
      writeFileSync(
        join(gateDir, "browser.json"),
        `${JSON.stringify({ note: browser.note, hits: browser.hits, shots: browser.shots }, null, 2)}\n`,
      );
      if (browser.hits.length > 0) {
        results.push({
          id: "admin-only-weights",
          status: "fail",
          detail: `member network has weight keys: ${browser.hits.map((hit) => hit.path).join(", ")}`,
        });
      } else {
        results.push({
          id: "admin-only-weights",
          status: "pass",
          detail: browser.note,
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ id: "admin-only-weights", status: "fail", detail: message });
  }

  results.push(await checkAdmission(repo));
  results.push(await checkSnapshots(repo));
  results.push(await checkReferralSignal(repo));

  for (const line of formatReport(results).trimEnd().split("\n")) say(line);
  writeFileSync(join(evidence, "run.txt"), `${lines.join("\n")}\n`);

  return results.filter((result) => result.status === "fail").length === 0 ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await executeRun());
}
