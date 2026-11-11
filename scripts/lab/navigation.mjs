// PF8's click-through: what the browser asks for when you move between the daily pages (docs/lab.md).
//
//   node scripts/lab/navigation.mjs [--user parent] [--width 1280] [--throttle none|cpu|mobile]
//                                   [--pause 16] [--moves Expenses,Reminders,To-dos,Home,Expenses,Reminders,To-dos]
//                                   [--start /dashboard] [--hover 0] [--label name]
//
// Signs in as one of the seed's users, loads Home cold and lets it settle, then taps the link to each
// page in `--moves` (the sidebar at 1280 px; at 390 the bottom bar, or the section's segmented control
// for a page that has no tab: To-dos is reached from Reminders, so keep that order), waiting `--pause` seconds before each tap. The default 16 s is longer than SWR's 15 s dedupe
// window, so a request SWR makes only because an answer is "stale" (a hook mounting on the next page)
// shows up instead of hiding inside the window.
//
// For the cold load and for each move it prints (one JSON object): every request by kind (page data
// `api`, `rsc` navigations and prefetches, `script`s with their size, other), the Auth calls the lab's
// delay proxy saw, how long until the page's skeleton and until its content (no `aria-busy` left in
// <main>) appeared after the tap, and the waterfall depth of the move: how many waits in a row the
// requests after the tap went through (an RSC request, then a script it needs, then a data request is
// 3). A move that needs only its RSC request is 1. Needs the lab running on http://localhost:3110.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("../../", import.meta.url).pathname;
const { findChrome, launchChrome, connect, signIn, MOBILE, linesBetween } = await import(`${REPO}/scripts/lab/measure.mjs`);

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const user = option("--user", "parent");
const width = Number(option("--width", "1280"));
const throttle = option("--throttle", "none");
const pauseMs = Number(option("--pause", "16")) * 1000;
const moves = option("--moves", "Expenses,Reminders,To-dos,Home,Expenses,Reminders,To-dos").split(",");
const label = option("--label", "run");
const start = option("--start", "/dashboard");
const hoverMs = Number(option("--hover", "0"));
const appUrl = "http://localhost:3110";
const HREFS = { Home: "/dashboard", Expenses: "/expenses", "To-dos": "/todos", Reminders: "/reminders", Calendar: "/calendar", More: "/more", Settings: "/settings" };
const PROXY_LOG = join(REPO, ".lab/supabase-calls.jsonl");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logSize = () => (existsSync(PROXY_LOG) ? statSync(PROXY_LOG).size : 0);

if (!["none", "cpu", "mobile"].includes(throttle)) throw new Error("--throttle is none, cpu or mobile");

/** Which request a path is: the app's data, a Next RSC request, a script, anything else. */
function kindOf(request) {
  const url = new URL(request.url);
  if (url.searchParams.has("_rsc")) return request.prefetch ? "rsc-prefetch" : "rsc";
  if (url.pathname.startsWith("/api/")) return url.pathname === "/api/client-log" || url.pathname === "/api/csp-report" ? "report" : "api";
  if (request.type === "Document") return "document";
  if (request.type === "Script") return "script";
  return "other";
}

/** Waits in a row: each request is one level below the deepest request that had finished when it started. */
function depthOf(requests) {
  const sorted = requests.filter((request) => request.start !== null).sort((a, b) => a.start - b.start);
  for (const request of sorted) {
    const before = sorted.filter((other) => other !== request && other.level !== undefined && other.end !== null && other.end <= request.start);
    request.level = 1 + Math.max(0, ...before.map((other) => other.level));
  }
  return Math.max(0, ...sorted.map((request) => request.level ?? 0));
}

function summarise(requests, authCalls) {
  const count = (kind) => requests.filter((request) => request.kind === kind);
  const api = count("api").map((request) => request.path);
  const scripts = count("script");
  return {
    api,
    rscNavigations: count("rsc").map((request) => request.path),
    rscMs: count("rsc").map((request) => Math.round(request.end - request.start)),
    rscPrefetches: count("rsc-prefetch").length,
    scripts: scripts.length,
    scriptKiB: Number((scripts.reduce((sum, request) => sum + request.bytes, 0) / 1024).toFixed(1)),
    other: count("other").length,
    authCalls,
    // The waterfall of what matters to the page: its own RSC request, new scripts and data requests (a prefetch isn't waited on).
    depth: depthOf(requests.filter((request) => ["rsc", "script", "api", "document"].includes(request.kind)).map((request) => ({ ...request }))),
  };
}

const users = JSON.parse(readFileSync(`${REPO}/.lab/users.json`, "utf8")).users;
if (!users[user]) throw new Error(`no seed user "${user}"`);
const cookies = await signIn(appUrl, users[user]);
const chrome = await launchChrome(findChrome());
const cdp = await connect(chrome.webSocketUrl);
try {
  const requests = new Map();
  cdp.on("Network.requestWillBeSent", ({ requestId, request, timestamp, type }) => {
    if (requests.has(requestId)) return;
    const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]));
    const parsed = new URL(request.url);
    requests.set(requestId, { url: request.url, path: parsed.pathname + (parsed.pathname.startsWith("/api/") ? parsed.search : ""), type, prefetch: Boolean(headers["next-router-prefetch"]), wall: Date.now(), start: timestamp * 1000, end: null, bytes: 0 });
  });
  cdp.on("Network.loadingFinished", ({ requestId, timestamp, encodedDataLength }) => {
    const entry = requests.get(requestId);
    if (entry) Object.assign(entry, { end: timestamp * 1000, bytes: encodedDataLength });
  });
  cdp.on("Network.loadingFailed", ({ requestId, timestamp }) => {
    const entry = requests.get(requestId);
    if (entry) Object.assign(entry, { end: timestamp * 1000 });
  });
  await cdp.send("Network.enable");
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.setCookies", { cookies });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: throttle === "none" ? width : MOBILE.width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
  if (throttle !== "none") await cdp.send("Emulation.setCPUThrottlingRate", { rate: MOBILE.cpuSlowdown });
  if (throttle === "mobile") {
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: MOBILE.latencyMs, downloadThroughput: (MOBILE.downloadKbps * 1024) / 8, uploadThroughput: (MOBILE.uploadKbps * 1024) / 8 });
  }
  const evaluate = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })).result?.value;
  const waitFor = async (expression, ms) => {
    const from = Date.now();
    while (Date.now() - from < ms) {
      if (await evaluate(expression)) return Date.now() - from;
      await sleep(25);
    }
    return null;
  };
  const SKELETON = `document.querySelector('#main-content [aria-busy="true"]') !== null`;
  const loaded = (href) => `location.pathname === "${href}" && Boolean(document.getElementById("main-content")) && document.querySelector('#main-content [aria-busy="true"]') === null`;

  /** Waits until nothing new has been requested for `quiet` ms. */
  async function settle(quiet = 2500, max = 40_000) {
    const from = Date.now();
    let seen = requests.size;
    let last = Date.now();
    while (Date.now() - from < max) {
      await sleep(250);
      if (requests.size !== seen || [...requests.values()].some((request) => request.end === null && Date.now() - request.wall < 30_000)) {
        seen = requests.size;
        last = Date.now();
      }
      if (Date.now() - last >= quiet) return;
    }
  }

  const result = { label, user, width, throttle, pauseSeconds: pauseMs / 1000, cold: null, moves: [] };
  const phase = async (action) => {
    requests.clear();
    const offset = logSize();
    const startedAt = Date.now();
    const timing = await action();
    await settle();
    const proxy = linesBetween(existsSync(PROXY_LOG) ? readFileSync(PROXY_LOG, "utf8").slice(offset) : "", startedAt - 1, Date.now() + 1, (line) => line.t);
    const list = [...requests.values()].map((request) => ({ ...request, kind: kindOf(request) }));
    return { ...timing, ...summarise(list, proxy.filter((line) => line.api === "auth").length), supabaseCalls: proxy.length };
  };

  result.cold = await phase(async () => {
    await cdp.send("Page.navigate", { url: `${appUrl}${start}` });
    return { loadedMs: await waitFor(loaded(start), 60_000) };
  });
  for (const move of moves) {
    await sleep(pauseMs);
    const href = HREFS[move];
    if (!href) throw new Error(`unknown page "${move}"`);
    const entry = await phase(async () => {
      // A tap: with `--hover N`, the pointer is over the link N ms first (what an `IntentLink` prefetches on).
      const find = `(() => {
        const visible = (el) => el.getBoundingClientRect().width > 0;
        let target = [...document.querySelectorAll('a[href="${href}"]')].find(visible);
        if (!target) target = [...document.querySelectorAll('[aria-label$=" pages"] label, [aria-label$=" pages"] button')].find((el) => visible(el) && el.textContent.trim() === ${JSON.stringify(move)});
        return target;
      })()`;
      if (hoverMs > 0) {
        await evaluate(`(() => { const target = ${find}; target?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); target?.dispatchEvent(new Event("touchstart", { bubbles: true })); })()`);
        await sleep(hoverMs);
      }
      const tapped = Date.now();
      const found = await evaluate(`(() => { const target = ${find}; target?.click(); return Boolean(target); })()`);
      if (!found) throw new Error(`no visible link to ${move}`);
      // Milliseconds after the tap: the URL changing (the navigation committed: the page or its skeleton
      // is on screen), the skeleton, and the loaded page.
      const times = { urlMs: null, skeletonMs: null, loadedMs: null };
      const checks = { urlMs: `location.pathname === "${href}"`, skeletonMs: SKELETON, loadedMs: loaded(href) };
      while (Date.now() - tapped < 30_000 && times.loadedMs === null) {
        for (const [name, expression] of Object.entries(checks)) {
          if (times[name] === null && (await evaluate(expression))) times[name] = Date.now() - tapped;
        }
        await sleep(15);
      }
      return { ...times, pathname: await evaluate("location.pathname") };
    });
    result.moves.push({ move, ...entry });
  }
  const out = join(REPO, ".lab/results/navigation");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${label}.json`), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
} finally {
  cdp.close();
  await chrome.close();
}
