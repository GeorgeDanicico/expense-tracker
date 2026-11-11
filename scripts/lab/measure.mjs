#!/usr/bin/env node
// Signed-in measurement in the lab (docs/lab.md, docs/performance.md "Signed-in lab baseline").
//
//   npm run lab:measure -- <page> [<page> …] [--user parent|adult|kid|solo] [--runs 3]
//                          [--throttle mobile|cpu|none] [--no-lighthouse] [--json] [--label text] [--out dir]
//
// For each page and run it signs the user in through the app's real sign-in route (POST /api/auth)
// and gives a new, empty browser profile exactly the session cookies that route set. Then it loads
// the page cold, twice:
//   1. Chromium driven over the DevTools protocol, with applied throttling (the values Lighthouse
//      uses for `--throttling-method=devtools` on its mobile preset). This pass records what really
//      happened: when the page's content appeared (a marker, below), every request with its start
//      and end, the waterfall depth, LCP and which element it was, CLS, long tasks, JS bytes, and the
//      server's own log lines and Supabase calls for that load.
//      `--throttle cpu` keeps the phone's screen and 4x slower CPU but not the slow network. Use it to
//      see the server: Chrome's applied latency (562.5 ms per request) starts when a request is sent
//      and hides any server time shorter than that, so on `mobile` a slower server barely shows.
//   2. Lighthouse 13.6.0, default mobile preset (simulated throttling), for the headline FCP, LCP,
//      CLS, TBT and time to interactive. Same pinned version as PF1.
// One unmeasured warm-up load per page comes first, so the server is warm (as production's is).
//
// The content marker: the first animation frame in which one of the page's own data strings (an
// expense's description, a reminder's or a to-do's title, Home's month total as the card formats it)
// is in the page, has a size, and isn't inside a loading placeholder. It's read from the same API the
// page calls, so it is the page's data and not its frame. (Until PF6 Home's marker was the month
// card's title, "Spent in <month>", which is drawn before its data: since PF3 it measured the frame.) "Settled" is when the last loading
// placeholder (`aria-busy="true"`) left the page.
//
// It reads .lab/app.env, .lab/users.json, the app's log (.lab/app.log) and the delay proxy's call
// log (.lab/supabase-calls.jsonl), all written by scripts/lab.sh. Results go to .lab/results/.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { guardProblems, parseEnvFile } from "./guard.mjs";
import { bucharestToday } from "./seed.mjs";

const LAB = process.env.LAB_DIR ?? ".lab";
export const LIGHTHOUSE_VERSION = "13.6.0";

/** Lighthouse's mobile preset (Moto G Power) and its devtools throttling values for slow 4G. */
export const MOBILE = {
  width: 412,
  height: 823,
  deviceScaleFactor: 1.75,
  userAgent: "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36",
  cpuSlowdown: 4,
  latencyMs: 562.5,
  downloadKbps: 1474.56,
  uploadKbps: 675,
};

// ---- small statistics -------------------------------------------------------------------------

export function median(values) {
  const sorted = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function spread(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return numbers.length === 0 ? null : Math.max(...numbers) - Math.min(...numbers);
}

// ---- page metrics from observed events ----------------------------------------------------------

/**
 * CLS as Chrome and Lighthouse define it: layout shifts without recent input, grouped in session
 * windows (a gap under 1 s, at most 5 s long); the largest window's sum.
 */
export function cumulativeLayoutShift(shifts) {
  let best = 0;
  let current = 0;
  let windowStart = -Infinity;
  let previous = -Infinity;
  for (const shift of [...shifts].sort((a, b) => a.t - b.t)) {
    if (shift.t - previous >= 1000 || shift.t - windowStart >= 5000) {
      current = 0;
      windowStart = shift.t;
    }
    current += shift.value;
    previous = shift.t;
    best = Math.max(best, current);
  }
  return best;
}

/** The most requests in flight at any moment of [from, to). */
function maxInFlight(requests, from, to) {
  const events = [];
  for (const request of requests) {
    const start = Math.max(request.start, from);
    const end = Math.min(request.end ?? Infinity, to);
    if (start < end) events.push([start, 1], [end, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let most = 0;
  for (const [, change] of events) {
    current += change;
    most = Math.max(most, current);
  }
  return most;
}

/**
 * Time to interactive and total blocking time, Lighthouse's definitions applied to what was
 * observed: find the first 5-second window after FCP with no long task and at most two requests in
 * flight; TTI is the end of the last long task before that window (FCP when there is none). TBT adds
 * up the part over 50 ms of every long task between FCP and TTI.
 */
export function interactiveAndBlocking({ fcp, longTasks, requests, endOfRecording }) {
  if (fcp === null || fcp === undefined) return { tti: null, tbt: null };
  const tasks = [...longTasks].sort((a, b) => a.start - b.start);
  const ends = (list, end) => list.map(end).filter((value) => value !== null && value > fcp);
  const starts = [...new Set([fcp, ...ends(tasks, (task) => task.start + task.duration), ...ends(requests, (request) => request.end)])].sort((a, b) => a - b);
  let tti = null;
  for (const windowStart of starts) {
    const windowEnd = windowStart + 5000;
    if (windowEnd > endOfRecording) break;
    const busy = tasks.some((task) => task.start < windowEnd && task.start + task.duration > windowStart);
    if (!busy && maxInFlight(requests, windowStart, windowEnd) <= 2) {
      tti = Math.max(fcp, ...tasks.map((task) => task.start + task.duration).filter((end) => end <= windowStart));
      break;
    }
  }
  const until = tti ?? endOfRecording;
  let tbt = 0;
  for (const task of tasks) {
    const start = Math.max(task.start, fcp);
    const end = Math.min(task.start + task.duration, until);
    if (end - start > 50) tbt += end - start - 50;
  }
  return { tti, tbt: Math.round(tbt) };
}

/**
 * The waterfall, measured: each request gets a level, the number of waits in a row before it could
 * start (PF1's "levels" in "The request waterfall", but from what happened, not from the code).
 *   - The document is level 0.
 *   - A request gets one more than the request that asked for it: the document for the scripts it
 *     names, the script whose code called `fetch` for an API request (Chrome's initiator).
 *   - An API request that started only after another API request had finished gets one more than
 *     that one too, when that is higher: that's the wait the initiator can't show (the layout
 *     waiting for /api/account, a list waiting for its rows).
 * Each request's `after` is what set its level. The depth is the number of levels down to the
 * deepest API request (the document counts as one), so PF1's "page, scripts, account, data" is 4.
 * The API-after-API rule reads timing, so two unrelated requests that happen to run one after the
 * other also count; the `after` column lets you check each one.
 */
export function waterfall(requests) {
  const nodes = [...requests].sort((a, b) => a.start - b.start).map((request) => ({ ...request, level: 0, after: null }));
  const byUrl = new Map();
  for (const node of nodes) {
    if (node.kind !== "document") {
      const parent = node.initiator ? byUrl.get(node.initiator) : undefined;
      node.level = parent ? parent.level + 1 : 1;
      node.after = parent ? parent.name : null;
      if (node.kind === "api") {
        for (const other of nodes) {
          if (other === node || other.kind !== "api" || other.end === null || other.end > node.start) continue;
          if (other.level + 1 > node.level) {
            node.level = other.level + 1;
            node.after = other.name;
          }
        }
      }
    }
    if (node.url && !byUrl.has(node.url)) byUrl.set(node.url, node);
  }
  const api = nodes.filter((node) => node.kind === "api");
  return { depth: api.length ? Math.max(...api.map((node) => node.level)) + 1 : 0, nodes };
}

/**
 * Whether the LCP element was the loading screen or something the page drew. "page" doesn't say it
 * was the page's data: a heading or a subtitle counts too, so read the element's text with it.
 */
export function lcpKind(element) {
  if (!element) return "none";
  if (element.inBusy || /Opening your ledger|Loading/i.test(element.text ?? "")) return "loading screen";
  return "page";
}

// ---- the server's side, from the lab's logs ----------------------------------------------------

/** The JSON lines of `text` with `when(line)` (epoch ms) in [from, to]. Other lines are skipped. */
export function linesBetween(text, from, to, when) {
  const lines = [];
  for (const raw of text.split("\n")) {
    if (!raw.startsWith("{")) continue;
    try {
      const line = JSON.parse(raw);
      const at = when(line);
      if (at >= from && at <= to) lines.push(line);
    } catch {
      // Not a log line.
    }
  }
  return lines;
}

/** The browser's own reports: not page requests, so left out of the API counts. */
const REPORT_ROUTES = new Set(["/api/client-log", "/api/csp-report"]);

const spanCount = (spans, test) => (spans ?? []).filter((span) => test(span.name)).reduce((sum, span) => sum + (span.count ?? 1), 0);

/**
 * One cold load's server numbers: the app's `request` lines (API requests, their time, spans and
 * dbCalls) and every call the delay proxy passed to Supabase, which includes the calls no `request`
 * line shows (the proxy's own `getClaims`, server-rendered pages).
 */
export function serverNumbers(requestLines, proxyLines) {
  const requests = requestLines.filter((line) => line.event === "request" && !REPORT_ROUTES.has(line.route));
  const routes = {};
  for (const line of requests) {
    const route = routes[`${line.method} ${line.route}`] ??= { count: 0, ms: [], dbCalls: 0, authSpans: 0, getFamily: 0 };
    route.count += 1;
    route.ms.push(line.ms);
    route.dbCalls += line.dbCalls ?? 0;
    route.authSpans += spanCount(line.spans, (name) => name.startsWith("auth."));
    route.getFamily += spanCount(line.spans, (name) => name === "rpc.get_family");
  }
  const auth = proxyLines.filter((line) => line.api === "auth");
  return {
    apiRequests: requests.length,
    dbCallsLogged: requests.reduce((sum, line) => sum + (line.dbCalls ?? 0), 0),
    authSpansLogged: Object.values(routes).reduce((sum, route) => sum + route.authSpans, 0),
    getFamilyLogged: Object.values(routes).reduce((sum, route) => sum + route.getFamily, 0),
    supabaseCalls: proxyLines.length,
    authCalls: auth.length,
    authUserCalls: auth.filter((line) => line.name === "/user").length,
    authOtherCalls: auth.filter((line) => line.name !== "/user").map((line) => line.name),
    getFamilyCalls: proxyLines.filter((line) => line.api === "rpc" && line.name === "get_family").length,
    routes,
  };
}

// ---- signing in ---------------------------------------------------------------------------------

/** A Set-Cookie header as a CDP cookie for `url`. */
export function cookieFromHeader(header, url) {
  const [pair, ...attributes] = header.split(";").map((part) => part.trim());
  const equals = pair.indexOf("=");
  const cookie = { name: pair.slice(0, equals), value: pair.slice(equals + 1), url, path: "/" };
  for (const attribute of attributes) {
    const [key, value = ""] = attribute.split("=");
    const name = key.toLowerCase();
    if (name === "httponly") cookie.httpOnly = true;
    else if (name === "secure") cookie.secure = true;
    else if (name === "samesite") cookie.sameSite = value[0].toUpperCase() + value.slice(1).toLowerCase();
    else if (name === "path") cookie.path = value;
    else if (name === "max-age") cookie.expires = Math.floor(Date.now() / 1000) + Number(value);
  }
  return cookie;
}

/**
 * fetch, tried once more after a network error (never after an HTTP error), and said so on stderr.
 * One request in the first CPU-only sweep failed with "fetch failed" and ended a 20-minute run; the
 * app was fine and the cause wasn't found. A retry is logged, so a sweep that needed one shows it.
 */
export async function fetchOnceMore(url, init, { fetcher = fetch, log = (line) => process.stderr.write(`${line}\n`) } = {}) {
  try {
    return await fetcher(url, init);
  } catch (error) {
    log(`  lab measure: ${init?.method ?? "GET"} ${new URL(url).pathname} failed (${error.message}); trying once more`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return fetcher(url, init);
  }
}

/** Signs in through POST /api/auth, as the sign-in form does; returns the cookies it set. */
export async function signIn(appUrl, account) {
  const response = await fetchOnceMore(`${appUrl}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: appUrl },
    body: JSON.stringify({ mode: "login", email: account.signIn, password: account.password }),
  });
  if (!response.ok) throw new Error(`sign-in answered ${response.status}`);
  const cookies = response.headers.getSetCookie().map((header) => cookieFromHeader(header, appUrl)).filter((cookie) => cookie.value !== "" && !(cookie.expires <= Date.now() / 1000));
  if (cookies.length === 0) throw new Error("sign-in set no cookie");
  return cookies;
}

export const cookieHeader = (cookies) => cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

// ---- what the page's data looks like (the marker and the first-HTML check) ------------------------


/** Home's month total as its card writes it (`formatCurrency` in src/lib/utils/currency.ts). */
const formatTotal = (amount, currency) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);

/** GET `path` from the app as the signed-in `cookies`; the JSON, or null when it isn't a 2xx. */
async function getJson(appUrl, cookies, path) {
  const response = await fetchOnceMore(`${appUrl}${path}`, { headers: { cookie: cookieHeader(cookies) } });
  return response.ok ? response.json() : null;
}

/**
 * Home's data strings for this user, read from the APIs Home's blocks call: `expenses` is the month's
 * total as the card writes it and the five newest expenses (empty for a kid without the expenses
 * permission, who gets a 403), then the reminders' and the open to-dos' titles.
 */
export async function homeStrings(appUrl, cookies) {
  const get = (path) => getJson(appUrl, cookies, path);
  const [account, dashboard, reminders, todos] = await Promise.all([
    get("/api/account"),
    get(`/api/dashboard?period=3m&granularity=month&date=${bucharestToday().slice(0, 7)}`),
    get("/api/reminders"),
    get("/api/todos"),
  ]);
  return {
    expenses: dashboard && account ? [formatTotal(dashboard.currentTotal, account.currency), ...dashboard.currentExpenses.slice(0, 5).map((expense) => expense.description)] : [],
    reminders: (reminders?.reminders ?? []).map((reminder) => reminder.title),
    todos: (todos?.todos ?? []).filter((todo) => todo.status !== "done").map((todo) => todo.title),
  };
}

/**
 * The page's own data strings, read from the API the page calls with the same session: the content
 * marker waits for one of them, and the first-HTML check looks for them. For Home, `homeStrings`.
 */
export async function probesFor(page, appUrl, cookies) {
  const get = (path) => getJson(appUrl, cookies, path);
  const month = bucharestToday().slice(0, 7);
  if (page.startsWith("/dashboard")) {
    const { expenses, reminders, todos } = await homeStrings(appUrl, cookies);
    return { strings: [...new Set([...expenses, ...reminders, ...todos])] };
  }
  if (page.startsWith("/expenses")) {
    const data = await get(`/api/expenses?month=${month}`);
    const list = data?.expenses ?? data?.items ?? [];
    return { strings: [...new Set(list.map((expense) => expense.description))].slice(0, 15) };
  }
  if (page.startsWith("/todos")) {
    const data = await get("/api/todos");
    return { strings: (data?.todos ?? []).filter((todo) => todo.status !== "done").map((todo) => todo.title).slice(0, 15) };
  }
  if (page.startsWith("/reminders")) {
    const data = await get("/api/reminders");
    return { strings: (data?.reminders ?? []).map((reminder) => reminder.title).slice(0, 15) };
  }
  return { strings: [] };
}

/** The script put in the page before any of its own: observers for paint, LCP, shifts, long tasks and the marker. */
export function observerScript({ strings }) {
  return `(() => {
  const STRINGS = ${JSON.stringify(strings)};
  const lab = (window.__lab = { lcp: [], shifts: [], longTasks: [], content: null, sawBusy: false, settled: null });
  const inBusy = (el) => Boolean(el && el.closest && el.closest('[aria-busy="true"]'));
  const describe = (el) => el ? { tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim().slice(0, 60), inBusy: inBusy(el) } : null;
  const observe = (type, fn) => { try { new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch {} };
  observe("largest-contentful-paint", (e) => lab.lcp.push({ t: e.startTime, size: e.size, element: describe(e.element) }));
  observe("layout-shift", (e) => { if (!e.hadRecentInput) lab.shifts.push({ t: e.startTime, value: e.value }); });
  observe("longtask", (e) => lab.longTasks.push({ start: e.startTime, duration: e.duration }));
  function findContent() {
    const body = document.body;
    if (!body) return null;
    const all = body.textContent || "";
    if (!STRINGS.some((s) => all.includes(s))) return null;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.data.trim();
      if (!text || !STRINGS.includes(text)) continue;
      const el = node.parentElement;
      if (!el || inBusy(el) || el.closest("[aria-hidden='true'], script, template")) continue;
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return { text: text.slice(0, 60), inViewport: box.top < innerHeight && box.bottom > 0 };
    }
    return null;
  }
  let pending = false;
  function onFrame(t) {
    pending = false;
    if (!lab.content) {
      const found = findContent();
      if (found) lab.content = { t, ...found };
    }
    const busy = document.querySelector('[aria-busy="true"]');
    if (busy) { lab.sawBusy = true; lab.settled = null; }
    else if (lab.sawBusy && lab.settled === null) lab.settled = t;
  }
  new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(onFrame); } })
    .observe(document, { childList: true, subtree: true, characterData: true });
})();`;
}

// ---- Chromium over the DevTools protocol ------------------------------------------------------------

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    join(homedir(), "Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
    join(homedir(), ".cache/ms-playwright/chromium-1194/chrome-linux/chrome"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error("no Chromium found: set CHROME_PATH");
  return found;
}

const CHROME_FLAGS = [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--disable-component-update", "--disable-sync", "--disable-extensions", "--metrics-recording-only",
  "--mute-audio", "--password-store=basic", "--use-mock-keychain", "--disable-features=Translate,OptimizationHints,MediaRouter",
];

export async function launchChrome(chromePath) {
  const profile = mkdtempSync(join(tmpdir(), "lab-chrome-"));
  const child = spawn(chromePath, [...CHROME_FLAGS, `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const close = async () => {
    child.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    const portFile = join(profile, "DevToolsActivePort");
    for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
    const targets = await (await fetchOnceMore(`http://127.0.0.1:${port}/json/list`)).json();
    return { webSocketUrl: targets.find((target) => target.type === "page").webSocketDebuggerUrl, close };
  } catch (error) {
    // Never leave a browser behind: a failed start stops the one it started.
    await close();
    throw error;
  }
}

export async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const waiting = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const entry = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) entry?.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry?.resolve(message.result);
    } else {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params);
    }
  });
  return {
    send(method, params = {}) {
      id += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => waiting.set(id, { resolve, reject, method }));
    },
    on(method, listener) {
      listeners.set(method, [...(listeners.get(method) ?? []), listener]);
    },
    close: () => socket.close(),
  };
}

const kindOf = (url, type) => {
  const { pathname, search } = new URL(url);
  if (type === "Document") return "document";
  if (search.includes("_rsc=")) return "rsc";
  if (pathname.startsWith("/api/")) return REPORT_ROUTES.has(pathname) ? "report" : "api";
  if (type === "Script") return "script";
  return "other";
};

/** One cold load in a fresh browser. Returns what the page and the network did. */
async function observedLoad({ chromePath, url, cookies, probes, throttle }) {
  const chrome = await launchChrome(chromePath);
  let cdp = null;
  try {
    cdp = await connect(chrome.webSocketUrl);
    const requests = new Map();
    let lastNetwork = Date.now();
    cdp.on("Network.requestWillBeSent", ({ requestId, request, timestamp, wallTime, type, initiator }) => {
      lastNetwork = Date.now();
      // Who asked for it: the document (parser) or the script on top of the stack that called fetch.
      const frames = [];
      for (let stack = initiator?.stack; stack; stack = stack.parent) frames.push(...stack.callFrames);
      const asker = initiator?.url ?? frames.find((frame) => frame.url)?.url ?? null;
      if (!requests.has(requestId)) requests.set(requestId, { url: request.url, method: request.method, type, initiator: asker, startTs: timestamp, wallTime, endTs: null, bytes: 0, status: null });
    });
    cdp.on("Network.responseReceived", ({ requestId, response, type }) => {
      const entry = requests.get(requestId);
      if (entry) Object.assign(entry, { status: response.status, type: type ?? entry.type });
    });
    cdp.on("Network.loadingFinished", ({ requestId, timestamp, encodedDataLength }) => {
      lastNetwork = Date.now();
      const entry = requests.get(requestId);
      if (entry) Object.assign(entry, { endTs: timestamp, bytes: encodedDataLength });
    });
    cdp.on("Network.loadingFailed", ({ requestId, timestamp }) => {
      lastNetwork = Date.now();
      const entry = requests.get(requestId);
      if (entry) Object.assign(entry, { endTs: timestamp, failed: true });
    });

    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.setCookies", { cookies });
    if (throttle !== "none") {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: MOBILE.width, height: MOBILE.height, deviceScaleFactor: MOBILE.deviceScaleFactor, mobile: true });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
      await cdp.send("Network.setUserAgentOverride", { userAgent: MOBILE.userAgent });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: MOBILE.cpuSlowdown });
    }
    if (throttle === "mobile") {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: MOBILE.latencyMs,
        downloadThroughput: (MOBILE.downloadKbps * 1024) / 8,
        uploadThroughput: (MOBILE.uploadKbps * 1024) / 8,
      });
    }
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: observerScript(probes) });

    const started = Date.now();
    await cdp.send("Page.navigate", { url });
    const evaluate = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;

    // Wait for the content, then for a quiet five seconds (no long task, nothing on the network), at most 60 s.
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const state = await evaluate(`window.__lab ? JSON.stringify({ content: Boolean(__lab.content), lastTask: Math.max(0, ...__lab.longTasks.map((t) => t.start + t.duration)), origin: performance.timeOrigin }) : null`).catch(() => null);
      const parsed = state ? JSON.parse(state) : null;
      const lastTaskWall = parsed ? parsed.origin + parsed.lastTask : started;
      const quietFor = Date.now() - Math.max(lastNetwork, lastTaskWall);
      if ((parsed?.content && quietFor >= 5500) || Date.now() - started > 60_000) break;
    }
    const finished = Date.now();
    const page = JSON.parse(await evaluate(`JSON.stringify({ lab: window.__lab, origin: performance.timeOrigin, now: performance.now(), fcp: (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime ?? null, firstPaint: (performance.getEntriesByName("first-paint")[0] || {}).startTime ?? null, nav: performance.getEntriesByType("navigation")[0]?.toJSON() ?? null })`));

    // Network timestamps are seconds on a monotonic clock; line them up with the page's clock through the document request's wall time.
    const all = [...requests.values()];
    const documentRequest = all.find((request) => request.type === "Document");
    const offset = documentRequest.wallTime * 1000 - page.origin;
    const toPage = (ts) => (ts === null ? null : (ts - documentRequest.startTs) * 1000 + offset);
    const list = all.map((request) => ({
      name: (() => { const parsed = new URL(request.url); return `${request.method === "GET" ? "" : `${request.method} `}${parsed.pathname}${parsed.search.length > 60 ? `${parsed.search.slice(0, 60)}…` : parsed.search}`; })(),
      kind: kindOf(request.url, request.type),
      url: request.url.split("#")[0],
      initiator: request.initiator?.split("#")[0] ?? null,
      status: request.status,
      start: Math.round(toPage(request.startTs)),
      end: request.endTs === null ? null : Math.round(toPage(request.endTs)),
      bytes: request.bytes,
    }));
    const flow = waterfall(list.filter((request) => request.kind === "document" || request.kind === "script" || request.kind === "api"));
    const lcp = page.lab.lcp.at(-1) ?? null;
    const timing = interactiveAndBlocking({
      fcp: page.fcp,
      longTasks: page.lab.longTasks,
      requests: list.filter((request) => request.start !== null),
      endOfRecording: page.now,
    });
    return {
      window: { from: started, to: finished },
      // First paint: the first frame with anything drawn (the loading skeleton's grey boxes). FCP
      // needs text or an image, and the skeleton has neither, so FCP waits for the first real text.
      firstPaint: page.firstPaint === null ? null : Math.round(page.firstPaint),
      fcp: page.fcp === null ? null : Math.round(page.fcp),
      lcp: lcp ? Math.round(lcp.t) : null,
      lcpElement: lcp?.element ?? null,
      lcpKind: lcpKind(lcp?.element),
      cls: Number(cumulativeLayoutShift(page.lab.shifts).toFixed(4)),
      tbt: timing.tbt,
      tti: timing.tti === null ? null : Math.round(timing.tti),
      content: page.lab.content ? Math.round(page.lab.content.t) : null,
      contentText: page.lab.content?.text ?? null,
      contentInViewport: page.lab.content?.inViewport ?? null,
      settled: page.lab.settled === null ? null : Math.round(page.lab.settled),
      ttfb: page.nav ? Math.round(page.nav.responseStart) : null,
      longTasks: page.lab.longTasks.length,
      requests: list.length,
      jsBytes: list.filter((request) => request.kind === "script").reduce((sum, request) => sum + request.bytes, 0),
      totalBytes: list.reduce((sum, request) => sum + request.bytes, 0),
      waterfallDepth: flow.depth,
      waterfall: flow.nodes.filter((node) => node.kind !== "script").concat(
        flow.nodes.filter((node) => node.kind === "script").length
          ? [summariseScripts(flow.nodes.filter((node) => node.kind === "script"))]
          : [],
      ).sort((a, b) => a.start - b.start),
      prefetches: list.filter((request) => request.kind === "rsc").map(({ name, start, end, bytes }) => ({ name, start, end, bytes })),
      allRequests: list,
      // What the browser asked for that reaches the session check: the page and each RSC request
      // go through the proxy (one getClaims each), each API request through the proxy and withUser
      // (two), and a browser report (/api/client-log) reads the user itself (one).
      authExpected: {
        page: list.filter((request) => request.kind === "document").length,
        rscPrefetches: list.filter((request) => request.kind === "rsc").length,
        api: 2 * list.filter((request) => request.kind === "api").length,
        reports: list.filter((request) => request.kind === "report" && request.name.includes("client-log")).length,
      },
    };
  } finally {
    cdp?.close();
    await chrome.close();
  }
}

/** The page's scripts as one row: how many, from the first start to the last end. */
function summariseScripts(scripts) {
  return {
    name: `${scripts.length} script files`,
    kind: "script",
    start: Math.min(...scripts.map((script) => script.start)),
    end: Math.max(...scripts.map((script) => script.end ?? 0)),
    level: Math.max(...scripts.map((script) => script.level)),
    after: scripts[0].after,
    bytes: scripts.reduce((sum, script) => sum + script.bytes, 0),
  };
}

// ---- Lighthouse ---------------------------------------------------------------------------------------

async function lighthouseLoad({ chromePath, url, cookies, outDir, index }) {
  const headersFile = join(outDir, `.headers-${index}.json`);
  const reportFile = join(outDir, `lighthouse-${index}.json`);
  writeFileSync(headersFile, JSON.stringify({ Cookie: cookieHeader(cookies) }), { mode: 0o600 });
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("npx", [
        "-y", `lighthouse@${LIGHTHOUSE_VERSION}`, url, "--only-categories=performance", "--output=json", `--output-path=${reportFile}`,
        `--extra-headers=${headersFile}`, "--quiet", `--chrome-flags=${CHROME_FLAGS.join(" ")}`,
      ], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, CHROME_PATH: chromePath } });
      let errors = "";
      child.stderr.on("data", (chunk) => { errors += chunk; });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`lighthouse exited ${code}: ${errors.slice(-300)}`))));
    });
  } finally {
    rmSync(headersFile, { force: true });
  }
  return lighthouseNumbers(JSON.parse(readFileSync(reportFile, "utf8")));
}

/** The numbers this lab reads from a Lighthouse JSON report. */
export function lighthouseNumbers(report) {
  const audit = (id) => report.audits[id]?.numericValue ?? null;
  // Lighthouse 13 names the LCP element in the LCP breakdown insight (a list whose node item is the element).
  const lcpItem = report.audits["lcp-breakdown-insight"]?.details?.items?.find((item) => item.type === "node") ?? null;
  const scripts = report.audits["resource-summary"]?.details?.items?.find((item) => item.resourceType === "script");
  return {
    fcp: audit("first-contentful-paint"),
    lcp: audit("largest-contentful-paint"),
    cls: audit("cumulative-layout-shift"),
    tbt: audit("total-blocking-time"),
    tti: audit("interactive"),
    speedIndex: audit("speed-index"),
    score: report.categories?.performance?.score ?? null,
    lcpElement: lcpItem ? { label: lcpItem.nodeLabel, snippet: lcpItem.snippet?.slice(0, 120) } : null,
    scriptBytes: scripts?.transferSize ?? null,
    finalUrl: report.finalDisplayedUrl ?? report.finalUrl,
    warnings: report.runWarnings ?? [],
  };
}

// ---- the command ------------------------------------------------------------------------------------

/** What each `--throttle` applies to the observed load (Lighthouse always uses its own mobile preset). */
export const THROTTLES = {
  mobile: "Lighthouse mobile (devtools values: 562.5 ms latency, 1.44 Mbit/s down, 4x CPU)",
  cpu: "phone screen and 4x CPU, no network throttling",
  none: "none",
};

export function parseArgs(argv) {
  const options = { pages: [], user: "parent", runs: 3, throttle: "mobile", lighthouse: true, json: false, label: "", out: null, warmup: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (argv[index] === undefined) throw new Error(`${arg} needs a value`);
      return argv[index];
    };
    if (arg === "--user") options.user = next();
    else if (arg === "--runs") options.runs = Number(next());
    else if (arg === "--throttle") options.throttle = next();
    else if (arg === "--no-lighthouse") options.lighthouse = false;
    else if (arg === "--no-warmup") options.warmup = false;
    else if (arg === "--json") options.json = true;
    else if (arg === "--label") options.label = next();
    else if (arg === "--out") options.out = next();
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg.startsWith("/")) options.pages.push(arg);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 20) throw new Error("--runs is 1 to 20");
  if (!THROTTLES[options.throttle]) throw new Error(`--throttle is ${Object.keys(THROTTLES).join(", ")}`);
  return options;
}

const readOptional = (path) => (existsSync(path) ? readFileSync(path, "utf8").trim() : null);
const sizeOf = (path) => (existsSync(path) ? statSync(path).size : 0);
/** The text of `path` after byte `offset` (all of it if the file was replaced by a shorter one). */
function readFrom(path, offset) {
  if (!existsSync(path)) return "";
  const buffer = readFileSync(path);
  return buffer.subarray(offset <= buffer.length ? offset : 0).toString("utf8");
}

/** Median and spread of `key` over the runs. */
function stat(runs, key) {
  const values = runs.map((run) => key.split(".").reduce((value, part) => value?.[part], run));
  return { median: median(values), spread: spread(values), values };
}

export function summarise(page, user, runs) {
  const observed = runs.map((run) => run.observed);
  const lighthouse = runs.map((run) => run.lighthouse).filter(Boolean);
  const server = runs.map((run) => run.server);
  const routes = {};
  for (const run of server) {
    for (const [route, numbers] of Object.entries(run.routes)) {
      const entry = routes[route] ??= { count: [], ms: [], dbCalls: [], authSpans: [], getFamily: [] };
      entry.count.push(numbers.count);
      entry.ms.push(...numbers.ms);
      entry.dbCalls.push(numbers.dbCalls / numbers.count);
      entry.authSpans.push(numbers.authSpans / numbers.count);
      entry.getFamily.push(numbers.getFamily / numbers.count);
    }
  }
  const middle = [...observed].sort((a, b) => (a.content ?? Infinity) - (b.content ?? Infinity))[Math.floor(observed.length / 2)];
  return {
    page,
    user,
    runs: runs.length,
    observed: Object.fromEntries(["firstPaint", "fcp", "lcp", "cls", "tbt", "tti", "content", "settled", "ttfb", "waterfallDepth", "requests", "jsBytes", "totalBytes"].map((key) => [key, stat(observed, key)])),
    lcpKinds: observed.map((run) => run.lcpKind),
    lcpElements: observed.map((run) => run.lcpElement),
    contentTexts: observed.map((run) => run.contentText),
    lighthouse: lighthouse.length ? Object.fromEntries(["fcp", "lcp", "cls", "tbt", "tti", "speedIndex", "scriptBytes"].map((key) => [key, stat(lighthouse, key)])) : null,
    lighthouseLcpElements: lighthouse.map((run) => run.lcpElement),
    lighthouseFinalUrls: lighthouse.map((run) => run.finalUrl),
    server: {
      ...Object.fromEntries(["apiRequests", "supabaseCalls", "authCalls", "authUserCalls", "authSpansLogged", "dbCallsLogged", "getFamilyCalls", "getFamilyLogged"].map((key) => [key, stat(server, key)])),
      authOtherCalls: server.map((run) => run.authOtherCalls),
      routes: Object.fromEntries(Object.entries(routes).map(([route, entry]) => [route, {
        perLoad: median(entry.count), msMedian: median(entry.ms), dbCalls: median(entry.dbCalls), authSpans: median(entry.authSpans), getFamily: median(entry.getFamily),
      }])),
    },
    dataInFirstHtml: runs.map((run) => run.html.dataInHtml),
    htmlBytes: median(runs.map((run) => run.html.bytes)),
    medianRunWaterfall: middle?.waterfall ?? [],
    authExpected: middle?.authExpected ?? {},
    medianRunPrefetches: middle?.prefetches ?? [],
  };
}

export const fmt = (value, digits = 0) => (typeof value !== "number" || !Number.isFinite(value) ? "–" : value.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
export const ms = (entry) => (entry?.median === null || entry?.median === undefined ? "–" : `${fmt(entry.median)} (±${fmt(entry.spread / 2)})`);

export function markdown(summary, context) {
  const { observed: o, lighthouse: l, server: s } = summary;
  const lines = [
    `### ${summary.page} as ${summary.user}`,
    "",
    `${context.jwtMode} JWT, +${context.delayMs} ms per Supabase call, build ${context.build}, ${summary.runs} runs (median, ±half the spread), throttle ${context.throttle}.`,
    "",
    "| Number | Observed (applied throttling) | Lighthouse (simulated) |",
    "| --- | ---: | ---: |",
    `| Content on screen (marker) | ${ms(o.content)} | |`,
    `| All placeholders gone | ${ms(o.settled)} | |`,
    `| First paint (the skeleton) | ${ms(o.firstPaint)} | |`,
    `| FCP | ${ms(o.fcp)} | ${ms(l?.fcp)} |`,
    `| LCP | ${ms(o.lcp)} | ${ms(l?.lcp)} |`,
    `| LCP element | ${[...new Set(summary.lcpKinds)].join(", ")}: ${JSON.stringify(summary.lcpElements[0]?.text ?? "")} | ${summary.lighthouseLcpElements[0]?.label ?? "–"} |`,
    `| CLS | ${fmt(o.cls.median, 3)} | ${fmt(l?.cls.median, 3)} |`,
    `| TBT | ${ms(o.tbt)} | ${ms(l?.tbt)} |`,
    `| Time to interactive | ${ms(o.tti)} | ${ms(l?.tti)} |`,
    `| Waterfall depth | ${fmt(o.waterfallDepth.median)} | |`,
    `| Requests / JS KiB / total KiB | ${fmt(o.requests.median)} / ${fmt(o.jsBytes.median / 1024, 1)} / ${fmt(o.totalBytes.median / 1024, 1)} | ${l ? `JS ${fmt(l.scriptBytes.median / 1024, 1)} KiB` : ""} |`,
    `| Data in the first HTML | ${summary.dataInFirstHtml.every(Boolean) ? "yes" : summary.dataInFirstHtml.some(Boolean) ? "sometimes" : "no"} | |`,
    "",
    `Server, per cold load: ${fmt(s.apiRequests.median)} API requests, ${fmt(s.supabaseCalls.median)} Supabase calls, **${fmt(s.authCalls.median)} Auth calls** (${fmt(s.authSpansLogged.median)} of them in request lines), ${fmt(s.dbCallsLogged.median)} logged dbCalls, get_family() ${fmt(s.getFamilyCalls.median)}.`,
    `Where the Auth calls come from, if every session check is one call (median run): page ${summary.authExpected.page}, RSC prefetches ${summary.authExpected.rscPrefetches}, API ${summary.authExpected.api} (2 each), browser reports ${summary.authExpected.reports}: ${Object.values(summary.authExpected).reduce((a, b) => a + b, 0)}.`,
    "",
    "| Route | Per load | Server ms (median) | dbCalls | auth spans | get_family |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(s.routes).sort().map(([route, r]) => `| \`${route}\` | ${fmt(r.perLoad)} | ${fmt(r.msMedian)} | ${fmt(r.dbCalls, 1)} | ${fmt(r.authSpans, 1)} | ${fmt(r.getFamily, 1)} |`),
    "",
    "Waterfall of the median run (ms from navigation start; `after` = the request that finished last before this one started):",
    "",
    "| Request | Start | End | After |",
    "| --- | ---: | ---: | --- |",
    ...summary.medianRunWaterfall.map((node) => `| \`${node.name}\` | ${fmt(node.start)} | ${fmt(node.end)} | ${node.after ? `\`${node.after}\`` : ""} |`),
  ];
  if (summary.medianRunPrefetches.length) lines.push("", `Prefetches (RSC): ${summary.medianRunPrefetches.map((prefetch) => `\`${prefetch.name.split("?")[0]}\` ${fmt(prefetch.start)}–${fmt(prefetch.end)} ms`).join(", ")}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || options.pages.length === 0) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 4).map((line) => line.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(options.help ? 0 : 2);
  }
  const env = parseEnvFile(readFileSync(join(LAB, "app.env"), "utf8"));
  const problems = guardProblems(env);
  if (problems.length) throw new Error(`refusing: ${problems.join("; ")}`);
  const users = JSON.parse(readFileSync(join(LAB, "users.json"), "utf8")).users;
  const account = users[options.user];
  if (!account) throw new Error(`no seeded user ${options.user} (${Object.keys(users).join(", ")})`);
  const appUrl = new URL(env.SITE_URL).origin;
  const chromePath = findChrome();
  const context = {
    jwtMode: readOptional(join(LAB, "jwt-mode")) ?? "unknown",
    delayMs: Number(readOptional(join(LAB, "delay-ms")) ?? 0),
    build: readOptional(join(LAB, "build-commit")) ?? "unknown",
    throttle: THROTTLES[options.throttle],
    throttleMode: options.throttle,
    chrome: chromePath,
    lighthouse: options.lighthouse ? LIGHTHOUSE_VERSION : null,
    at: new Date().toISOString(),
  };
  const stamp = context.at.replace(/[:.]/g, "-");
  const outDir = options.out ?? join(LAB, "results", `${stamp}${options.label ? `-${options.label}` : ""}`);
  mkdirSync(outDir, { recursive: true });

  const summaries = [];
  for (const page of options.pages) {
    const url = `${appUrl}${page}`;
    const slug = `${page.replace(/\W+/g, "_")}-${options.user}`;
    if (options.warmup) {
      const cookies = await signIn(appUrl, account);
      await observedLoad({ chromePath, url, cookies, probes: await probesFor(page, appUrl, cookies), throttle: "none" });
    }
    const runs = [];
    for (let index = 0; index < options.runs; index += 1) {
      const cookies = await signIn(appUrl, account);
      const probes = await probesFor(page, appUrl, cookies);
      const html = await (await fetchOnceMore(url, { headers: { cookie: cookieHeader(cookies) } })).text();
      const dataInHtml = probes.strings.some((text) => html.includes(text));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      // Read only what the logs gain from here on: they hold every earlier load too.
      const offsets = { app: sizeOf(join(LAB, "app.log")), proxy: sizeOf(join(LAB, "supabase-calls.jsonl")) };
      const observed = await observedLoad({ chromePath, url, cookies, probes, throttle: options.throttle });
      // Lines are written when a request ends; give the last ones (and the background "last active" write) a moment.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const appLog = readFrom(join(LAB, "app.log"), offsets.app);
      const proxyLog = readFrom(join(LAB, "supabase-calls.jsonl"), offsets.proxy);
      const requestLines = linesBetween(appLog, observed.window.from, observed.window.to + 1000, (line) => Date.parse(line.time));
      const proxyLines = linesBetween(proxyLog, observed.window.from, observed.window.to, (line) => line.t);
      const server = serverNumbers(requestLines, proxyLines);
      writeFileSync(join(outDir, `requests-${slug}-${index}.jsonl`), requestLines.map((line) => JSON.stringify(line)).join("\n") + "\n");
      let lighthouse = null;
      if (options.lighthouse) {
        lighthouse = await lighthouseLoad({ chromePath, url, cookies: await signIn(appUrl, account), outDir, index: `${slug}-${index}` });
      }
      runs.push({ observed, server, lighthouse, html: { dataInHtml, bytes: Buffer.byteLength(html) } });
      if (!options.json) process.stderr.write(`  ${page} ${options.user} run ${index + 1}: content ${observed.content ?? "–"} ms, LCP ${observed.lcp ?? "–"} ms (${observed.lcpKind}), depth ${observed.waterfallDepth}, Auth calls ${server.authCalls}\n`);
    }
    const summary = summarise(page, options.user, runs);
    summaries.push(summary);
    writeFileSync(join(outDir, `runs-${slug}.json`), JSON.stringify({ context, runs }, null, 2));
  }
  writeFileSync(join(outDir, "summary.json"), JSON.stringify({ context, summaries }, null, 2));
  const report = summaries.map((summary) => markdown(summary, context)).join("\n");
  writeFileSync(join(outDir, "summary.md"), report);
  if (options.json) console.log(JSON.stringify({ context, summaries }, null, 2));
  else console.log(`${report}\nSaved in ${outDir}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`lab measure: ${error.message}`);
    process.exit(1);
  });
}
