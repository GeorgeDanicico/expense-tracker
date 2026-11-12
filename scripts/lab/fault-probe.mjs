// Times what a signed-in page shows when Supabase breaks, as the parent at 390 px (or --width): a cold
// load of a page, or a tab tap to it from another page. PF13 follow-up (docs/performance.md, PF13
// section 7, "Fixed in").
//
//   node scripts/lab/fault-probe.mjs <cold|tap> <fault> <path> [--from /dashboard] [--width 390] [--seconds 60]
//     fault: stop     docker stop PostgREST just before (Kong hangs 10 to 60 s on the first calls, then answers 503)
//            settled  stop PostgREST and wait until Kong answers 503 at once (a fast failure)
//            pause    docker pause the gateway (a hang)
//   Prints JSON: when the page showed "taking longer" and the error ("Try again") in ms from the
//   fault, the page and API requests after it, the Supabase calls the delay proxy saw and the app's
//   log lines. The fault is undone at the end. The lab must be up (`npm run lab -- up`); it only talks
//   to http://localhost:3110 and the lab's own containers.
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("../../", import.meta.url).pathname;
const { findChrome, cookieFromHeader } = await import(`${REPO}/scripts/lab/measure.mjs`);

const [mode, fault, path, ...rest] = process.argv.slice(2);
const option = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
const from = option("--from", "/dashboard");
const width = Number(option("--width", "390"));
const seconds = Number(option("--seconds", "60"));
const appUrl = "http://localhost:3110";
const FAULTS = {
  stop: ["docker stop supabase_rest_expense-tracker-lab", "docker start supabase_rest_expense-tracker-lab"],
  // Stopped, and Kong already knows it (it answers 503 "name resolution failed" at once).
  settled: ["docker stop supabase_rest_expense-tracker-lab && for i in $(seq 90); do c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 http://127.0.0.1:54321/rest/v1/); [ \"$c\" = 503 ] && break; sleep 1; done", "docker start supabase_rest_expense-tracker-lab"],
  pause: ["docker pause supabase_kong_expense-tracker-lab", "docker unpause supabase_kong_expense-tracker-lab"],
};
const [breakIt, mendIt] = FAULTS[fault];

async function signIn() {
  const users = JSON.parse(readFileSync(`${REPO}/.lab/users.json`, "utf8")).users;
  const response = await fetch(`${appUrl}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: appUrl },
    body: JSON.stringify({ mode: "login", email: users.parent.signIn, password: users.parent.password }),
  });
  if (!response.ok) throw new Error(`sign-in ${response.status}`);
  return response.headers.getSetCookie().map((h) => cookieFromHeader(h, appUrl)).filter((c) => c.value !== "");
}

const sizeOf = (file) => (existsSync(file) ? statSync(file).size : 0);
const tail = (file, offset) => (existsSync(file) ? readFileSync(file).subarray(offset).toString("utf8") : "");
const cookies = await signIn();
const profile = mkdtempSync(join(tmpdir(), "fault-probe-"));
const child = spawn(findChrome(), ["--headless=new", "--no-first-run", "--disable-extensions", "--password-store=basic", "--use-mock-keychain", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
console.error(`chromium pid ${child.pid}`);
const exited = new Promise((r) => child.once("exit", r));
let broken = false;
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
  const send = (method, params = {}) => new Promise((r) => { id += 1; const my = id; waiting.set(my, r); socket.send(JSON.stringify({ id: my, method, params })); setTimeout(() => { if (waiting.delete(my)) r({ result: { value: "{}" } }); }, 5000); });
  const on = (method, l) => (listeners[method] ??= []).push(l);
  const read = async () => {
    const r = await send("Runtime.evaluate", { expression: "JSON.stringify({p: location.pathname, t: document.body ? document.body.innerText : '', busy: document.querySelectorAll('[aria-busy=true]').length})", returnByValue: true });
    try { return JSON.parse(r.result.value); } catch { return null; }
  };

  await send("Network.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height: width < 600 ? 800 : 900, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Network.setCookies", { cookies });

  let t0 = null;
  const since = () => (t0 === null ? null : Date.now() - t0);
  const requests = new Map();
  on("Network.requestWillBeSent", (p) => {
    if (t0 === null) return;
    const url = new URL(p.request.url);
    const rsc = p.request.headers.RSC === "1" || p.request.headers.rsc === "1" || url.searchParams.has("_rsc");
    if (!rsc && !url.pathname.startsWith("/api/") && p.type !== "Document") return;
    requests.set(p.requestId, { kind: rsc ? "rsc" : p.type === "Document" ? "doc" : "api", url: url.pathname, start: since(), headers: null, end: null, status: null });
  });
  on("Network.responseReceived", (p) => { const r = requests.get(p.requestId); if (r) { r.headers = since(); r.status = p.response.status; } });
  on("Network.loadingFinished", (p) => { const r = requests.get(p.requestId); if (r) r.end = since(); });
  on("Network.loadingFailed", (p) => { const r = requests.get(p.requestId); if (r) { r.end = since(); r.status = `failed ${p.errorText}`; } });

  if (mode === "tap") {
    await send("Page.navigate", { url: appUrl + from });
    for (let i = 0; i < 100; i++) {
      const s = await read();
      if (s && s.t.length > 200 && s.busy === 0 && !/Loading/.test(s.t)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const appLog = `${REPO}/.lab/app.log`;
  const callLog = `${REPO}/.lab/supabase-calls.jsonl`;
  const appOffset = sizeOf(appLog);
  const callOffset = sizeOf(callLog);
  execSync(breakIt, { stdio: "ignore" });
  broken = true;
  t0 = Date.now();
  if (mode === "tap") {
    await send("Runtime.evaluate", { expression: `document.querySelector('a[href="${path}"]').click()` });
  } else {
    await send("Page.navigate", { url: appUrl + path });
  }
  const events = [];
  let last = "";
  while (since() < seconds * 1000) {
    const s = await read();
    if (s) {
      const state = [
        s.p !== (mode === "tap" ? from : path) ? `at ${s.p}` : `still ${s.p}`,
        /taking longer than usual/i.test(s.t) ? "slow" : null,
        /Try again/.test(s.t) ? "error" : null,
        /^\s*$/.test(s.t) ? "blank" : null,
      ].filter(Boolean).join(" + ");
      if (state !== last) { events.push({ at: since(), state }); last = state; }
      if (/Try again/.test(s.t)) break;
    }
    await new Promise((x) => setTimeout(x, 100));
  }
  const errorAt = events.find((e) => e.state.includes("error"))?.at ?? null;
  await new Promise((x) => setTimeout(x, 1500));
  const final = await read();
  const t0Wall = t0;
  const calls = tail(callLog, callOffset).split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((c) => ({ at: c.t - t0Wall, ms: c.ms, method: c.method, api: c.api, name: c.name, status: c.status }));
  const logLines = tail(appLog, appOffset).split("\n").filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .map((l) => ({ at: Date.parse(l.time ?? l.ts ?? "") - t0Wall, event: l.event, route: l.route ?? l.api, status: l.status, ms: l.ms, error: l.error?.message ?? l.message ?? l.errorMessage }));
  console.log(JSON.stringify({ mode, fault, path, width, errorAt, events, requests: [...requests.values()], calls, logLines, finalText: final?.t?.slice(0, 300) }, null, 1));
  socket.close();
} finally {
  if (broken) execSync(mendIt, { stdio: "ignore" });
  child.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true });
}
