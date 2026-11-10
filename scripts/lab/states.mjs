// Opens a lab page in headless Chromium, signed in as the seed's parent (or not), and times when each
// loading state shows: loading, "taking longer than usual", the error, the sign-in page. Also lists the
// page's /api requests and saves a screenshot at each new state. PF2 (docs/performance.md) used it.
//
//   node scripts/lab/states.mjs <label> <path> <width> [options]
//     --anon             don't sign in
//     --seconds N        how long to watch (default 40)
//     --drop-cookies MS  at MS, delete the cookies and fire `online`, so the page's reads get a 401
//     --offline MS       at MS, emulate no network (0: as soon as the document arrives)
//     --fake-offline MS  at MS, make navigator.onLine false and fire `offline`
//   Environment: PRE / POST are shell commands run when the document arrives / when the run ends (for
//   example `docker pause supabase_kong_expense-tracker-lab` and its `unpause`); OUT is where the
//   screenshots go (default .lab/results/states). `scripts/lab/states.sh` runs the whole set.
//   The app must be up (`npm run lab -- up`). Only talks to http://localhost:3110.
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("../../", import.meta.url).pathname;
const { findChrome, cookieFromHeader } = await import(`${REPO}/scripts/lab/measure.mjs`);

const [label, path, widthArg, ...rest] = process.argv.slice(2);
const anon = rest.includes("--anon");
const seconds = Number(rest[rest.indexOf("--seconds") + 1]) || 40;
const offlineAfter = rest.includes("--offline") ? Number(rest[rest.indexOf("--offline") + 1]) : null;
const width = Number(widthArg);
const fakeOffline = rest.includes("--fake-offline") ? Number(rest[rest.indexOf("--fake-offline") + 1]) : null;
const dropAt = rest.includes("--drop-cookies") ? Number(rest[rest.indexOf("--drop-cookies") + 1]) : null;
const appUrl = "http://localhost:3110";
const out = join(process.env.OUT ?? join(REPO, ".lab/results/states"), label);
mkdirSync(out, { recursive: true });

const CACHE = new URL("../../.lab/states-cookies.json", import.meta.url);
async function signIn() {
  try {
    const cached = JSON.parse(readFileSync(CACHE, "utf8"));
    if (Date.now() - cached.at < 25 * 60_000) return cached.cookies;
  } catch {}
  for (let attempt = 0; attempt < 4; attempt++) {
    const cookies = await signInOnce();
    if (cookies) { writeFileSync(CACHE, JSON.stringify({ at: Date.now(), cookies })); return cookies; }
    await new Promise((r) => setTimeout(r, 30_000));
  }
  throw new Error("sign-in kept failing");
}
async function signInOnce() {
  const users = JSON.parse(readFileSync(`${REPO}/.lab/users.json`, "utf8")).users;
  const account = users.parent;
  const response = await fetch(`${appUrl}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: appUrl },
    body: JSON.stringify({ mode: "login", email: account.signIn, password: account.password }),
  });
  if (response.status === 429) return null;
  if (!response.ok) throw new Error(`sign-in ${response.status}`);
  return response.headers.getSetCookie().map((h) => cookieFromHeader(h, appUrl)).filter((c) => c.value !== "");
}

const cookies = anon ? [] : await signIn();
const after = () => { if (process.env.POST) execSync(process.env.POST, { cwd: REPO, stdio: "ignore" }); };

const profile = mkdtempSync(join(tmpdir(), "pf2-chrome-"));
const flags = ["--headless=new", "--no-first-run", "--disable-extensions", "--password-store=basic", "--use-mock-keychain", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"];
const child = spawn(findChrome(), flags, { stdio: "ignore" });
const exited = new Promise((r) => child.once("exit", r));
try {
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
  const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => socket.addEventListener("open", r, { once: true }));
  let id = 0;
  const waiting = new Map();
  const listeners = {};
  socket.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) { waiting.get(m.id)?.(m.result); waiting.delete(m.id); }
    else for (const l of listeners[m.method] ?? []) l(m.params);
  });
  const send = (method, params = {}) => new Promise((r) => { id += 1; const my = id; waiting.set(my, r); socket.send(JSON.stringify({ id: my, method, params })); setTimeout(() => { if (waiting.delete(my)) { console.error("timeout", method); r({ result: { value: "{}" } }); } }, 5000); });
  const on = (method, l) => (listeners[method] ??= []).push(l);

  await send("Network.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height: width < 600 ? 800 : 900, deviceScaleFactor: 1, mobile: width < 600 });
  if (cookies.length) await send("Network.setCookies", { cookies });

  const t0 = Date.now();
  const since = () => Date.now() - t0;
  const api = new Map();
  on("Network.requestWillBeSent", (p) => { if (new URL(p.request.url).pathname.startsWith("/api/")) api.set(p.requestId, { url: new URL(p.request.url).pathname, start: since(), end: null, status: null }); });
  const events = [];
  let pre = false;
  on("Network.responseReceived", (p) => {
    if (!pre && p.type === "Document" && offlineAfter === 0) { pre = true; send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); events.push({ at: since(), state: "went-offline" }); }
    if (!pre && p.type === "Document" && process.env.PRE) { pre = true; execSync(process.env.PRE, { cwd: REPO, stdio: "ignore" }); }
    const r = api.get(p.requestId);
    if (r) r.status = p.response.status;
  });
  on("Network.loadingFinished", (p) => { const r = api.get(p.requestId); if (r) r.end = since(); });
  on("Network.loadingFailed", (p) => { const r = api.get(p.requestId); if (r) { r.end = since(); r.status = "failed"; } });

  await send("Page.navigate", { url: appUrl + path });
  let last = "";
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(out, `${name}.png`), Buffer.from(data, "base64"));
  };
  const seen = new Set();
  let wentOffline = false;
  let dropped = false;
  let faked = false;
  while (since() < seconds * 1000) {
    if (offlineAfter !== null && offlineAfter > 0 && !wentOffline && since() >= offlineAfter) {
      wentOffline = true;
      await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      events.push({ at: since(), state: "went-offline" });
    }
    if (fakeOffline !== null && !faked && since() >= fakeOffline) {
      faked = true;
      await send("Runtime.evaluate", { expression: "Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }); window.dispatchEvent(new Event('offline'))" });
      events.push({ at: since(), state: "navigator-onLine-set-false" });
    }
    if (dropAt !== null && !dropped && since() >= dropAt) {
      dropped = true;
      await send("Network.clearBrowserCookies");
      await send("Runtime.evaluate", { expression: "window.dispatchEvent(new Event('online'))" });
      events.push({ at: since(), state: "cookies-dropped-and-revalidated" });
    }
    const r = await send("Runtime.evaluate", { expression: "JSON.stringify({p: location.pathname + location.search, t: document.body ? document.body.innerText : ''})", returnByValue: true });
    let s;
    try { s = JSON.parse(r.result.value); } catch { await new Promise((x) => setTimeout(x, 200)); continue; }
    const t = s.t;
    const state = [
      s.p.startsWith("/login") ? `login(${s.p})` : null,
      /taking longer than usual/i.test(t) ? "slow" : null,
      /offline/i.test(t) && /Unable to load data|You're offline/.test(t) ? "error-offline" : null,
      /Unable to load data/.test(t) ? "error" : null,
      /^\s*$/.test(t) ? "blank" : null,
    ].filter(Boolean).join("+") || (/Loading|Opening/.test(t) ? "loading" : "content");
    if (state !== last) {
      events.push({ at: since(), state, path: s.p });
      last = state;
      if (!seen.has(state)) { seen.add(state); await shot(state.replace(/[^a-z-]/gi, "_")); }
    }
    await new Promise((x) => setTimeout(x, 200));
  }
  const finalText = JSON.parse((await send("Runtime.evaluate", { expression: "JSON.stringify(document.body.innerText.slice(0,600))", returnByValue: true })).result.value);
  await shot("final");
  console.log(JSON.stringify({ label, path, width, events, api: [...api.values()], finalText }, null, 1));
  socket.close();
} finally {
  after();
  child.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true });
}
