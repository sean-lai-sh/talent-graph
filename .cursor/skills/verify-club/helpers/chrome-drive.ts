#!/usr/bin/env bun
/**
 * Local Chrome CDP fallback when cursor-ide-browser cannot load 127.0.0.1.
 * Usage:
 *   helpers/chrome-drive.ts goto <url>
 *   helpers/chrome-drive.ts screenshot <png>
 *   helpers/chrome-drive.ts click-name <accessible or visible name>
 *   helpers/chrome-drive.ts text <outfile>
 *   helpers/chrome-drive.ts aria <outfile>
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

type ChromeMeta = { port: number; ws: string; pid: number; userData: string };

function chromeBins(): string[] {
  const env = process.env.VERIFY_CLUB_CHROME_BIN;
  return [
    ...(env ? [env] : []),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ];
}

function resolveChromeBin(): string {
  for (const candidate of chromeBins()) {
    if (candidate.includes("/") && existsSync(candidate)) return candidate;
    if (!candidate.includes("/")) {
      const which = Bun.spawnSync(["bash", "-lc", `command -v ${JSON.stringify(candidate)}`]);
      const path = which.stdout.toString().trim();
      if (which.exitCode === 0 && path) return path;
    }
  }
  throw new Error(
    "no Chrome/Chromium binary. Set VERIFY_CLUB_CHROME_BIN or install google-chrome / chromium.",
  );
}

function pidAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portOwner(port: number): number | null {
  const r = Bun.spawnSync([
    "bash",
    "-lc",
    `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | head -n 1`,
  ]);
  const n = Number(r.stdout.toString().trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickPort(): number {
  const raw = process.env.VERIFY_CLUB_CHROME_PORT ?? "";
  if (raw && !/^[1-9][0-9]{0,4}$/.test(raw)) {
    throw new Error("VERIFY_CLUB_CHROME_PORT must be an integer 1–65535");
  }
  const preferred = Number(raw || 0);
  const start =
    preferred > 0 && preferred <= 65535 ? preferred : 9333 + (Number(process.pid) % 200);
  for (let p = start; p < start + 40; p++) {
    if (portOwner(p) === null) return p;
  }
  throw new Error("no free Chrome debug port");
}

async function listTargets(port: number) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`chrome json/list HTTP ${res.status}`);
  return (await res.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
}

async function ensureChrome(): Promise<ChromeMeta> {
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as ChromeMeta;
    const owner = portOwner(meta.port);
    if (pidAlive(meta.pid) && owner === meta.pid) {
      try {
        const targets = await listTargets(meta.port);
        const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) return { ...meta, ws: page.webSocketDebuggerUrl };
      } catch {
        /* relaunch */
      }
    } else if (owner && owner !== meta.pid) {
      throw new Error(
        `Chrome debug port ${meta.port} is owned by pid ${owner}, not our ${meta.pid}`,
      );
    }
  }

  const chromeBin = resolveChromeBin();
  const debugPort = pickPort();
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
  const pid = child.pid;
  if (!pid) throw new Error("Chrome spawned without a pid");

  let ws = "";
  for (let i = 0; i < 40; i++) {
    await Bun.sleep(150);
    const owner = portOwner(debugPort);
    if (owner && owner !== pid) {
      throw new Error(`refusing foreign Chrome on ${debugPort} (pid ${owner})`);
    }
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
  const meta: ChromeMeta = { port: debugPort, ws, pid, userData };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

async function withCdp<T>(
  wsUrl: string,
  fn: (send: <R>(method: string, params?: Record<string, unknown>) => Promise<R>) => Promise<T>,
): Promise<T> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((ok, err) => {
    ws.addEventListener("open", () => ok());
    ws.addEventListener("error", () => err(new Error("cdp socket error")));
  });
  let nextId = 1;
  const pending = new Map<
    number,
    { ok: (v: unknown) => void; err: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
    };
    if (msg.id == null) return;
    const slot = pending.get(msg.id);
    if (!slot) return;
    clearTimeout(slot.timer);
    pending.delete(msg.id);
    if (msg.error) slot.err(new Error(msg.error.message));
    else slot.ok(msg.result);
  });
  const send = <R>(method: string, params?: Record<string, unknown>) =>
    new Promise<R>((ok, err) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        err(new Error(`cdp timeout: ${method}`));
      }, 8000);
      pending.set(id, { ok: (v) => ok(v as R), err, timer });
      ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  try {
    return await fn(send);
  } finally {
    ws.close();
  }
}

type AxNode = {
  nodeId?: string;
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  childIds?: string[];
};

function flattenAx(nodes: AxNode[]): string {
  const byId = new Map(nodes.map((n) => [n.nodeId ?? "", n]));
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const n = byId.get(id);
    if (!n || n.ignored) return;
    const role = n.role?.value ?? "";
    const name = n.name?.value ?? "";
    if (role || name) lines.push(`${"  ".repeat(depth)}${role}${name ? ` "${name}"` : ""}`);
    for (const child of n.childIds ?? []) walk(child, depth + 1);
  };
  const root = nodes[0];
  if (root?.nodeId) walk(root.nodeId, 0);
  return `${lines.join("\n")}\n`;
}

const [cmd, arg] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: chrome-drive.ts goto|screenshot|click-name|text|aria …");
  process.exit(2);
}

const meta = await ensureChrome();

if (cmd === "goto") {
  if (!arg) throw new Error("goto needs a url");
  await withCdp(meta.ws, async (send) => {
    await send("Page.enable");
    await send("Page.navigate", { url: arg });
  });
  await Bun.sleep(1500);
  console.log(`verify-club chrome: goto ${arg}`);
} else if (cmd === "screenshot") {
  if (!arg) throw new Error("screenshot needs a png path");
  const out = resolve(arg);
  mkdirSync(dirname(out), { recursive: true });
  const shot = await withCdp(meta.ws, (send) =>
    send<{ data: string }>("Page.captureScreenshot", { format: "png" }),
  );
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`verify-club chrome: screenshot ${out}`);
} else if (cmd === "click-name") {
  if (!arg) throw new Error("click-name needs an accessible or visible name");
  const clicked = await withCdp(meta.ws, async (send) => {
    await send("Accessibility.enable");
    const tree = await send<{ nodes: AxNode[] }>("Accessibility.getFullAXTree");
    const interactive = new Set(["button", "link", "menuitem", "textbox", "searchbox", "tab"]);
    const scored = (tree.nodes ?? [])
      .filter((n) => !n.ignored && n.backendDOMNodeId && (n.name?.value || n.role?.value))
      .map((n) => {
        const name = n.name?.value ?? "";
        const role = n.role?.value ?? "";
        let score = 0;
        if (name === arg) score = interactive.has(role) ? 400 : 300;
        else if (name.includes(arg)) score = interactive.has(role) ? 200 : 100;
        return { n, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const target = scored[0]?.n;
    if (target?.backendDOMNodeId) {
      const resolved = await send<{ object: { objectId?: string } }>("DOM.resolveNode", {
        backendNodeId: target.backendDOMNodeId,
      });
      if (resolved.object.objectId) {
        await send("Runtime.callFunctionOn", {
          objectId: resolved.object.objectId,
          functionDeclaration: "function() { this.click(); }",
        });
        return true;
      }
    }
    const result = await send<{ result: { value: boolean } }>("Runtime.evaluate", {
      expression: `(() => {
        const needle = ${JSON.stringify(arg)};
        const nodes = [...document.querySelectorAll("button, a, [role='menuitem'], input, [aria-label]")];
        const scoreOf = (n) => {
          const aria = n.getAttribute("aria-label") || "";
          const text = (n.textContent || "").replace(/\\s+/g, " ").trim();
          if (aria === needle) return 400;
          if (text === needle) return 300;
          if (aria.includes(needle)) return 200;
          if (text.includes(needle)) return 100;
          return 0;
        };
        const el = nodes
          .map((n) => ({ n, score: scoreOf(n) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)[0]?.n;
        if (!el) return false;
        el.click();
        return true;
      })()`,
      returnByValue: true,
    });
    return result.result.value;
  });
  if (!clicked) {
    console.error(`verify-club chrome: no control named ${arg}`);
    process.exit(1);
  }
  await Bun.sleep(400);
  console.log(`verify-club chrome: clicked ${arg}`);
} else if (cmd === "text") {
  if (!arg) throw new Error("text needs an outfile");
  const result = await withCdp(meta.ws, (send) =>
    send<{ result: { value: string } }>("Runtime.evaluate", {
      expression: `document.body.innerText`,
      returnByValue: true,
    }),
  );
  const out = resolve(arg);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.result.value);
  console.log(`verify-club chrome: text ${out}`);
} else if (cmd === "aria") {
  if (!arg) throw new Error("aria needs an outfile");
  const tree = await withCdp(meta.ws, async (send) => {
    await send("Accessibility.enable");
    return send<{ nodes: AxNode[] }>("Accessibility.getFullAXTree");
  });
  const out = resolve(arg);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, flattenAx(tree.nodes ?? []));
  console.log(`verify-club chrome: aria ${out}`);
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}
