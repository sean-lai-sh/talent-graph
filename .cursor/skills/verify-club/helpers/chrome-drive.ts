#!/usr/bin/env bun
/**
 * Local Chrome CDP fallback when cursor-ide-browser cannot load 127.0.0.1.
 * Usage:
 *   helpers/chrome-drive.ts goto <url>
 *   helpers/chrome-drive.ts screenshot <png>
 *   helpers/chrome-drive.ts click-name <visibleText>
 *   helpers/chrome-drive.ts text <outfile>
 * Chrome is started once per run dir (.chrome-debug) and reused.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const skillDir = resolve(import.meta.dir, "..");
const current = resolve(skillDir, "runs/current");
if (!existsSync(current)) {
  console.error("verify-club chrome-drive: no current run");
  process.exit(1);
}
const runId = readFileSync(current, "utf8").trim();
const runDir = resolve(skillDir, "runs", runId);
const metaPath = resolve(runDir, "chrome.json");
const chromeBin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const debugPort = Number(process.env.VERIFY_CLUB_CHROME_PORT ?? 9333);

type ChromeMeta = { port: number; ws: string; pid: number };

async function listTargets(port: number) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`chrome json/list HTTP ${res.status}`);
  return (await res.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
}

async function ensureChrome(): Promise<ChromeMeta> {
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as ChromeMeta;
    try {
      const targets = await listTargets(meta.port);
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return { ...meta, ws: page.webSocketDebuggerUrl };
    } catch {
      /* relaunch */
    }
  }
  const userData = resolve(runDir, "chrome-profile");
  mkdirSync(userData, { recursive: true });
  const child = spawn(
    chromeBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userData}`,
      "--window-size=1440,900",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  let ws = "";
  for (let i = 0; i < 40; i++) {
    await Bun.sleep(150);
    try {
      const targets = await listTargets(debugPort);
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) {
        ws = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* not up yet */
    }
  }
  if (!ws) throw new Error("chrome debug port did not come up");
  const meta: ChromeMeta = { port: debugPort, ws, pid: child.pid ?? 0 };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

async function cdp<T>(wsUrl: string, method: string, params?: Record<string, unknown>): Promise<T> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((ok, err) => {
    ws.addEventListener("open", () => ok());
    ws.addEventListener("error", () => err(new Error("cdp socket error")));
  });
  const id = Math.floor(Math.random() * 1e9);
  const reply = new Promise<T>((ok, err) => {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: T;
        error?: { message: string };
      };
      if (msg.id !== id) return;
      if (msg.error) err(new Error(msg.error.message));
      else ok(msg.result as T);
    });
  });
  ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  try {
    return await reply;
  } finally {
    ws.close();
  }
}

const [cmd, arg] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: chrome-drive.ts goto|screenshot|click-name|text …");
  process.exit(2);
}

const meta = await ensureChrome();

if (cmd === "goto") {
  if (!arg) throw new Error("goto needs a url");
  await cdp(meta.ws, "Page.enable");
  await cdp(meta.ws, "Page.navigate", { url: arg });
  await Bun.sleep(1500);
  console.log(`verify-club chrome: goto ${arg}`);
} else if (cmd === "screenshot") {
  if (!arg) throw new Error("screenshot needs a png path");
  const out = resolve(arg);
  mkdirSync(dirname(out), { recursive: true });
  const shot = await cdp<{ data: string }>(meta.ws, "Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`verify-club chrome: screenshot ${out}`);
} else if (cmd === "click-name") {
  if (!arg) throw new Error("click-name needs visible text");
  const result = await cdp<{ result: { value: boolean } }>(meta.ws, "Runtime.evaluate", {
    expression: `(() => {
      const needle = ${JSON.stringify(arg)};
      const nodes = [...document.querySelectorAll("button, a, [role='menuitem']")];
      const el = nodes.find((n) => (n.textContent || "").includes(needle));
      if (!el) return false;
      el.click();
      return true;
    })()`,
    returnByValue: true,
  });
  if (!result.result.value) {
    console.error(`verify-club chrome: no control containing ${arg}`);
    process.exit(1);
  }
  await Bun.sleep(400);
  console.log(`verify-club chrome: clicked ${arg}`);
} else if (cmd === "text") {
  if (!arg) throw new Error("text needs an outfile");
  const result = await cdp<{ result: { value: string } }>(meta.ws, "Runtime.evaluate", {
    expression: `document.body.innerText`,
    returnByValue: true,
  });
  const out = resolve(arg);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.result.value);
  console.log(`verify-club chrome: text ${out}`);
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}
