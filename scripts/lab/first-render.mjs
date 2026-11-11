// PF6's check of a page whose first data comes from the server (docs/lab.md, docs/performance.md "PF6").
//
//   node scripts/lab/first-render.mjs [/dashboard] [--users parent,kid,solo] [--widths 390,1280]
//                                     [--shots <dir>] [--kid-without-expenses]
//
// For each user and width: signs in through the app's own route, then
//   1. fetches the page as a phone's browser would (its User-Agent: Next sends crawlers, Lighthouse
//      included, the whole page in one piece instead of streaming it) and reports the first byte, the
//      last byte, which of the user's data strings are in the HTML outside any script (the month's
//      total as Home formats it, the newest expense, the reminders' and to-dos' titles), and how many
//      Supabase calls the delay proxy logged for that one render;
//   2. loads it cold in a headless Chromium and lists every request to the app's data APIs during the
//      first render (until the page has been still for 3 s), every console error and warning, and
//      saves a screenshot of the screen when `--shots` is given.
// `--kid-without-expenses` turns the kid's expenses permission off (as the parent, through the app's
// own route) for the run and back on at the end: it changes the lab's data while it runs.
// It only talks to http://localhost:3110, which the lab's guard keeps on the lab database.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { guardProblems, parseEnvFile } from "./guard.mjs";
import { MOBILE, connect, cookieHeader, findChrome, homeStrings, launchChrome, signIn as labSignIn } from "./measure.mjs";

const REPO = new URL("../../", import.meta.url).pathname;
const problems = guardProblems(parseEnvFile(readFileSync(`${REPO}/.lab/app.env`, "utf8")));
if (problems.length) throw new Error(`refusing: ${problems.join("; ")}`);

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const page = args.find((arg, index) => arg.startsWith("/") && args[index - 1] !== "--shots") ?? "/dashboard";
const userKeys = option("--users", "parent,kid").split(",");
const widths = option("--widths", "390,1280").split(",").map(Number);
const shots = option("--shots", null);
const kidWithoutExpenses = args.includes("--kid-without-expenses");
const appUrl = "http://localhost:3110";
const DATA_APIS = ["/api/dashboard", "/api/reminders", "/api/todos", "/api/expenses"];
const users = JSON.parse(readFileSync(`${REPO}/.lab/users.json`, "utf8")).users;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const proxyLog = `${REPO}/.lab/supabase-calls.jsonl`;

async function call(cookies, method, path, body) {
  const response = await fetch(`${appUrl}${path}`, {
    method,
    headers: { cookie: cookieHeader(cookies), origin: appUrl, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
}

/** The page as a browser fetches it, timed, with the Supabase calls its one render made. */
async function fetchPage(cookies, strings) {
  const before = statSync(proxyLog).size;
  const started = performance.now();
  const response = await fetch(`${appUrl}${page}`, { headers: { cookie: cookieHeader(cookies), "user-agent": MOBILE.userAgent }, redirect: "manual" });
  const reader = response.body.getReader();
  let html = "";
  let firstByte = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    firstByte ??= performance.now() - started;
    html += Buffer.from(value).toString("utf8");
  }
  const lastByte = performance.now() - started;
  await sleep(1000);
  const calls = readFileSync(proxyLog, "utf8").slice(before).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
  const found = (list) => list.filter((text) => text && markup.includes(text)).length;
  return {
    status: response.status,
    firstByteMs: Math.round(firstByte),
    lastByteMs: Math.round(lastByte),
    inMarkup: { expenses: `${found(strings.expenses)}/${strings.expenses.length}`, monthTotal: strings.expenses[0] ? markup.includes(strings.expenses[0]) : null, reminders: `${found(strings.reminders)}/${strings.reminders.length}`, todos: `${found(strings.todos)}/${strings.todos.length}` },
    // Anywhere in the page, scripts and the RSC payload included: for a user who must get none of it.
    expensesAnywhere: strings.expenses.filter((text) => text && html.includes(text)).length,
    dashboardKeyAnywhere: html.includes("/api/dashboard"),
    supabaseCalls: calls.length,
    supabaseByApi: calls.reduce((counts, line) => ({ ...counts, [line.api]: (counts[line.api] ?? 0) + 1 }), {}),
  };
}

const parent = await labSignIn(appUrl, users.parent);
// Each user's data strings, read before the kid's permission changes, so the kid's own expenses are
// known and can be looked for in a page that must not have them.
const stringsFor = {};
for (const key of userKeys) stringsFor[key] = await homeStrings(appUrl, await labSignIn(appUrl, users[key]));
let kidMember = null;
if (kidWithoutExpenses) {
  const { body } = await call(parent, "GET", "/api/family");
  kidMember = body.family.members.find((entry) => entry.displayName === users.kid.displayName);
  const changed = await call(parent, "PATCH", `/api/family/members/${kidMember.memberId}/permissions`, { permissions: { ...kidMember.permissions, expenses: "off" } });
  if (changed.status !== 200) throw new Error(`could not turn the kid's expenses off: ${changed.status}`);
}

const chrome = await launchChrome(findChrome());
try {
  const { send, on, close } = await connect(chrome.webSocketUrl);
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true }).catch(() => null))?.result?.value;
  await Promise.all([send("Network.enable"), send("Page.enable"), send("Runtime.enable"), send("Log.enable")]);
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  let load = null;
  on("Network.requestWillBeSent", ({ request }) => {
    const url = new URL(request.url);
    if (load && DATA_APIS.some((api) => url.pathname === api || url.pathname.startsWith(`${api}/`) || url.pathname.startsWith(`${api}?`))) load.dataRequests.push(`${request.method} ${url.pathname}${url.search}`);
  });
  on("Runtime.consoleAPICalled", ({ type, args: values }) => {
    if (load && (type === "error" || type === "warning")) load.console.push(`${type}: ${values.map((value) => value.value ?? value.description ?? "").join(" ").slice(0, 300)}`);
  });
  on("Runtime.exceptionThrown", ({ exceptionDetails }) => load?.console.push(`exception: ${(exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 300)}`));
  on("Log.entryAdded", ({ entry }) => {
    if (load && (entry.level === "error" || entry.level === "warning")) load.console.push(`${entry.source} ${entry.level}: ${entry.text.slice(0, 300)}`);
  });

  for (const key of userKeys) {
    for (const width of widths) {
      const cookies = await labSignIn(appUrl, users[key]);
      const strings = stringsFor[key];
      const html = await fetchPage(cookies, strings);
      await send("Emulation.setDeviceMetricsOverride", { width, height: width < 600 ? 844 : 900, deviceScaleFactor: width < 600 ? 2 : 1, mobile: width < 600 });
      await send("Network.clearBrowserCookies");
      await send("Network.setCookies", { cookies });
      load = { user: key, width, dataRequests: [], console: [] };
      await send("Page.navigate", { url: appUrl + page });
      // Still: the same text and no busy placeholder for 3 s (at most 20 s).
      let last = "";
      for (let waited = 0, still = 0; waited < 20000 && still < 3000; waited += 250) {
        await sleep(250);
        const now = await evaluate(`document.querySelectorAll('[aria-busy="true"]').length + "|" + document.body?.innerText.length`);
        still = now === last && now?.startsWith("0|") ? still + 250 : 0;
        last = now;
      }
      if (shots) {
        mkdirSync(shots, { recursive: true });
        const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
        writeFileSync(join(shots, `after-${page.slice(1).replace(/\W+/g, "-")}-${key}${kidWithoutExpenses && key === "kid" ? "-no-expenses" : ""}-${width}.jpg`), Buffer.from(data, "base64"));
      }
      const result = { ...load, dashboardStatus: (await call(cookies, "GET", "/api/dashboard")).status, html };
      load = null;
      console.log(JSON.stringify(result));
    }
  }
  close();
} finally {
  await chrome.close();
  if (kidMember) await call(parent, "PATCH", `/api/family/members/${kidMember.memberId}/permissions`, { permissions: kidMember.permissions });
}
