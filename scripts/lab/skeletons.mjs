// PF3's check of a page's loading state against its loaded state, in the lab (docs/lab.md).
//
//   node scripts/lab/skeletons.mjs <path> <width> [--label name] [--out dir] [--selector css] [--tap <href>]
//
// Signs in as the seed's parent, opens <path> at <width> px with the app's own /api/account allowed
// through and every other /api request held, so the page sits in its loading state as long as it
// likes. It then records the loading state (a screenshot, and the height of the page's block and of
// each block in it), lets the requests go, waits for the content, and records the same again, plus
// every layout shift with the elements that moved (`layout-shift` entries' `sources`). It prints one
// JSON object. The numbers that matter: `loading.blocks` against `loaded.blocks` (the same heights
// mean nothing moves) and `shifts`.
//
// With `--tap <href>` it instead loads <path> to its end, then taps the link to <href> (a tab in the
// bottom bar or the sidebar) while every request for that page's data and its non-prefetch RSC request
// is held, and reports how long the loading state took to appear, with the `?_rsc=` requests that
// went out (prefetches or not) and how big each answer was. Only talks to http://localhost:3110.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("../../", import.meta.url).pathname;
const { findChrome, cookieFromHeader } = await import(`${REPO}/scripts/lab/measure.mjs`);

const [path, widthArg, ...rest] = process.argv.slice(2);
const option = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : null);
const width = Number(widthArg);
const label = option("--label") ?? "run";
const tapHref = option("--tap");
const selector = option("--selector"); // also list the boxes (top, height) of what this selector matches in <main>, for tuning a skeleton
const out = join(option("--out") ?? join(REPO, ".lab/results/skeletons"), label);
mkdirSync(out, { recursive: true });
const appUrl = "http://localhost:3110";

async function signIn() {
  const users = JSON.parse(readFileSync(`${REPO}/.lab/users.json`, "utf8")).users;
  const account = users.parent;
  const response = await fetch(`${appUrl}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: appUrl },
    body: JSON.stringify({ mode: "login", email: account.signIn, password: account.password }),
  });
  if (!response.ok) throw new Error(`sign-in ${response.status}`);
  return response.headers.getSetCookie().map((header) => cookieFromHeader(header, appUrl)).filter((cookie) => cookie.value !== "");
}

const profile = mkdtempSync(join(tmpdir(), "pf3-chrome-"));
const child = spawn(findChrome(), ["--headless=new", "--no-first-run", "--disable-extensions", "--password-store=basic", "--use-mock-keychain", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
const exited = new Promise((resolve) => child.once("exit", resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What the page injects before any of its code: layout shifts with the elements that moved.
const OBSERVER = `(() => {
  const lab = (window.__pf3 = { shifts: [] });
  const name = (el) => el ? el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + " " + (el.textContent || "").trim().slice(0, 40) : null;
  const box = (r) => ({ top: Math.round(r.top), height: Math.round(r.height) });
  try {
    new PerformanceObserver((list) => list.getEntries().forEach((e) => {
      if (e.hadRecentInput) return;
      lab.shifts.push({ t: Math.round(e.startTime), value: Number(e.value.toFixed(4)), sources: e.sources.map((s) => ({ node: name(s.node), from: box(s.previousRect), to: box(s.currentRect) })) });
    })).observe({ type: "layout-shift", buffered: true });
  } catch {}
})();`;

// The page's own block (the last child of <main>, after the offline bar and the section nav), each
// block in it and each card in it, as heights at this width.
const BLOCKS = `(() => {
  const main = document.getElementById("main-content");
  if (!main) return null;
  const page = main.lastElementChild;
  const round = (n) => Math.round(n * 10) / 10;
  const blocks = [...page.children].map((el) => ({ what: el.tagName.toLowerCase() + " " + (el.textContent || "").trim().slice(0, 28), height: round(el.getBoundingClientRect().height) }));
  const matched = ${JSON.stringify(selector)} ? [...main.querySelectorAll(${JSON.stringify(selector)})].map((el) => ({ top: Math.round(el.getBoundingClientRect().top - main.getBoundingClientRect().top), height: round(el.getBoundingClientRect().height), what: (el.textContent || "").trim().slice(0, 20) })) : undefined;
  const cards = [...page.querySelectorAll(".chakra-card__root")].map((el) => round(el.getBoundingClientRect().height));
  return { height: round(page.getBoundingClientRect().height), cards, matched, busy: Boolean(page.matches('[aria-busy="true"]') || page.querySelector('[aria-busy="true"]')), blocks };
})()`;

try {
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const waiting = new Map();
  const listeners = {};
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) { waiting.get(message.id)?.(message.result); waiting.delete(message.id); }
    else for (const listener of listeners[message.method] ?? []) listener(message.params);
  });
  const send = (method, params = {}) => new Promise((resolve) => { id += 1; waiting.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
  const on = (method, listener) => (listeners[method] ??= []).push(listener);
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.value;
  const shot = async (name) => writeFileSync(join(out, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));

  await send("Network.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Network.setCookies", { cookies: await signIn() });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVER });

  // Which requests to hold: everything under /api except the account and the browser's own reports.
  let holding = true;
  let holdRsc = null; // a path whose non-prefetch RSC request is held too (--tap)
  const held = [];
  const rsc = [];
  await send("Fetch.enable", { patterns: [{ urlPattern: `${appUrl}/*`, requestStage: "Request" }] });
  on("Fetch.requestPaused", (params) => {
    const url = new URL(params.request.url);
    const isApi = url.pathname.startsWith("/api/") && url.pathname !== "/api/account" && !url.pathname.startsWith("/api/client-log");
    const headers = params.request.headers;
    const isRsc = url.searchParams.has("_rsc");
    const prefetch = Boolean(headers["Next-Router-Prefetch"] ?? headers["next-router-prefetch"]);
    if (isRsc) rsc.push({ path: url.pathname, prefetch, held: false, t: Date.now() - startedAt, requestId: params.networkId });
    if (holding && (isApi || (holdRsc !== null && isRsc && !prefetch && url.pathname === holdRsc))) {
      if (isRsc) rsc.at(-1).held = true;
      held.push(params.requestId);
      return;
    }
    send("Fetch.continueRequest", { requestId: params.requestId });
  });
  const sizes = new Map();
  on("Network.loadingFinished", (params) => sizes.set(params.requestId, params.encodedDataLength));
  const release = async () => {
    holding = false;
    // All at once, as they would have arrived: one after another would split a frame the page draws in one.
    await Promise.all(held.splice(0).map((requestId) => send("Fetch.continueRequest", { requestId })));
  };
  const waitFor = async (expression, ms = 20000) => {
    for (let waited = 0; waited < ms; waited += 50) { if (await evaluate(expression)) return true; await sleep(50); }
    return false;
  };
  const startedAt = Date.now();

  const result = { label, path, width };
  await send("Page.navigate", { url: appUrl + path });
  if (tapHref === null) {
    result.sawLoading = await waitFor(`document.querySelector('#main-content [aria-busy="true"]') !== null`);
    await sleep(1500);
    result.loading = await evaluate(BLOCKS);
    await shot("loading");
    await release();
    await waitFor(`document.getElementById("main-content") && !document.querySelector('#main-content [aria-busy="true"]')`);
    await sleep(2500);
    result.loaded = await evaluate(BLOCKS);
    await shot("loaded");
    const lab = JSON.parse((await evaluate(`JSON.stringify(window.__pf3)`)) ?? "{}");
    result.shifts = lab.shifts ?? [];
    result.cls = Number(result.shifts.reduce((sum, shift) => sum + shift.value, 0).toFixed(4));
  } else {
    await release();
    await waitFor(`document.getElementById("main-content") && !document.querySelector('#main-content [aria-busy="true"]')`);
    await sleep(3000); // prefetches settle
    result.prefetches = rsc.map(({ path: p, prefetch }) => ({ path: p, prefetch }));
    holding = true;
    holdRsc = tapHref;
    const before = await evaluate(`document.title`);
    const tapped = Date.now();
    await evaluate(`(() => { const link = [...document.querySelectorAll('a[href="${tapHref}"]')].find((a) => a.getBoundingClientRect().width > 0); link?.click(); return Boolean(link); })()`);
    result.skeletonAfterMs = (await waitFor(`document.querySelector('#main-content [aria-busy="true"]') !== null`, 5000)) ? Date.now() - tapped : null;
    result.pathAfterTap = await evaluate(`location.pathname`);
    result.titleBefore = before;
    await shot("tapped");
    await release();
  }
  result.rsc = rsc.map(({ path: p, prefetch, held: h, requestId }) => ({ path: p, prefetch, held: h, bytes: sizes.get(requestId) ?? null }));
  console.log(JSON.stringify(result, null, 1));
  socket.close();
} finally {
  child.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true });
}
