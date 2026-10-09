/**
 * Browser proof. Drives the Chrome session verify-club already owns.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets, scanJsonText, type WeightHit } from "./scan.ts";

const CLUB_CHROME = join(import.meta.dir, "../../../verify-club/helpers/chrome-drive.ts");

function chrome(args: string[], env: Record<string, string> = {}): void {
  const stable = "/usr/bin/google-chrome-stable";
  const bin = existsSync(stable) ? { VERIFY_CLUB_CHROME_BIN: stable } : {};
  const result = spawnSync("bun", [CLUB_CHROME, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...bin, ...env },
  });
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    throw new Error(detail || `chrome-drive ${args[0] ?? ""} failed`);
  }
}

function signIn(appUrl: string, email: string, password: string, waitFor: string): void {
  chrome(["goto", `${appUrl}/login`]);
  chrome(["type-label", "Email"], { VERIFY_CLUB_TYPE_VALUE: email });
  chrome(["type-label", "Password"], { VERIFY_CLUB_TYPE_VALUE: password });
  chrome(["click-name", "Sign in"]);
  chrome(["wait-name", waitFor]);
}

function shot(dir: string, stem: string): { aria: string; png: string } {
  mkdirSync(dir, { recursive: true });
  const aria = join(dir, `${stem}.aria.txt`);
  const png = join(dir, `${stem}.png`);
  chrome(["aria", aria]);
  chrome(["screenshot", png]);
  return { aria, png };
}

export type BrowserEvidence = {
  shots: { aria: string; png: string }[];
  hits: WeightHit[];
  note: string;
};

export function driveBrowser(input: {
  appUrl: string;
  evidence: string;
  email: string;
  adminEmail: string;
  password: string;
}): BrowserEvidence {
  const memberDir = join(input.evidence, "admin-only", "member");
  const adminDir = join(input.evidence, "admin-only", "admin");
  const shots: { aria: string; png: string }[] = [];
  signIn(input.appUrl, input.email, input.password, "Forum");
  shots.push(shot(memberDir, "01-forum"));
  chrome(["click-name", "Member List"]);
  chrome(["wait-name", "Member List"]);
  shots.push(shot(memberDir, "02-member-list"));
  chrome(["click-name", "Submit Referral"]);
  chrome(["wait-name", "Submit Referral"]);
  shots.push(shot(memberDir, "03-referral"));

  const networkDir = join(memberDir, "network");
  chrome(["capture", `${input.appUrl}/members`, networkDir], {
    VERIFY_CLUB_REDACT: input.password,
  });
  assertTraffic(networkDir);
  const hits = scanCaptured(networkDir, [input.password]);

  chrome(["click-name", "Sign out"]);
  signIn(input.appUrl, input.adminEmail, input.password, "Council");
  chrome(["goto", `${input.appUrl}/admin`]);
  shots.push(shot(adminDir, "01-admin"));
  const linksFile = join(adminDir, "01-admin.links.txt");
  chrome(["links", linksFile]);
  const links = readAdminLinks(linksFile).filter((link) => !link.endsWith("/admin"));
  let index = 2;
  for (const link of links) {
    chrome(["goto", link]);
    shots.push(shot(adminDir, `${String(index).padStart(2, "0")}-admin`));
    index += 1;
    if (index > 6) break;
  }
  return {
    shots,
    hits,
    note: `member network hits ${hits.length}; admin pages ${1 + links.length}`,
  };
}

function readAdminLinks(path: string): string[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("/admin"));
  } catch {
    return [];
  }
}

function assertTraffic(dir: string): void {
  const frames = JSON.parse(readFileSync(join(dir, "frames.json"), "utf8")) as unknown[];
  const bodies = JSON.parse(readFileSync(join(dir, "bodies.json"), "utf8")) as {
    mime?: string;
    body?: string;
  }[];
  const json = bodies.filter((row) => (row.mime ?? "").includes("json") && (row.body ?? "") !== "");
  if (frames.length === 0 && json.length === 0) {
    throw new Error("member network capture saw no JSON or websocket payloads");
  }
}

function scanCaptured(dir: string, secrets: readonly string[]): WeightHit[] {
  const hits: WeightHit[] = [];
  const names = readdirSync(dir);
  for (const name of names) {
    if (!name.endsWith(".json") && !name.endsWith(".txt")) continue;
    const raw = redactSecrets(readFileSync(join(dir, name), "utf8"), secrets);
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const record = row as { mime?: string; body?: string; payload?: string };
      const mime = record.mime ?? "";
      if (mime.includes("javascript") || mime.includes("css")) continue;
      const text = record.body ?? record.payload ?? "";
      if (text === "") continue;
      for (const hit of scanJsonText(text)) {
        hits.push({ path: `${name}:${hit.path}`, key: hit.key });
      }
    }
  }
  return hits;
}
