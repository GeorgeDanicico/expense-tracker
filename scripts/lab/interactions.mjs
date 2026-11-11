// PF11's interaction timing: how long a tap or a key press takes to reach the next frame (docs/lab.md).
//
//   node scripts/lab/interactions.mjs [--user parent] [--scenario quick-add,type-amount,...]
//                                     [--width 390] [--throttle cpu|none] [--reps 5] [--label name] [--debug]
//
// Signs in as one of the seed's users and runs scripted taps and key presses in Chromium (a touch phone
// at 390 px, a mouse at 1280 px), with the CPU 4x slower for `--throttle cpu` (Lighthouse's mobile
// setting). The browser's Event Timing API times each interaction: from the input to the next frame
// that paints. That is what INP is made of (the page's INP is its slowest interaction), and this prints
// each interaction's own number, in ms, with the median and the worst of the `--reps` repetitions.
// Event Timing leaves out anything under 16 ms, so those count as 0 here: read a 0 as "under 16".
//
// Each repetition is a fresh page load in a new browser (an empty cache, as on a first visit; `--warm`
// keeps one browser), so "first" taps include a lazy chunk's download, and "warm" ones run after it. Needs the lab running on http://localhost:3110 (docs/lab.md). It changes the lab's
// data a little: reminders are marked done and a net-worth value is added.
import { readFileSync } from "node:fs";

const REPO = new URL("../../", import.meta.url).pathname;
const { findChrome, launchChrome, connect, signIn, MOBILE, median } = await import(`${REPO}/scripts/lab/measure.mjs`);

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const user = option("--user", "parent");
const width = Number(option("--width", "390"));
const throttle = option("--throttle", "cpu");
const reps = Number(option("--reps", "5"));
const label = option("--label", "run");
const debug = argv.includes("--debug");
const touch = width < 600;
const appUrl = "http://localhost:3110";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const users = JSON.parse(readFileSync(`${REPO}/.lab/users.json`, "utf8")).users;
if (!users[user]) throw new Error(`no seed user "${user}"`);

/** Runs in every page before its own scripts: Event Timing entries and the times a text first shows. */
const OBSERVER = `
  window.__ev = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__ev.push({ n: e.name, s: e.startTime, d: e.duration, id: e.interactionId, p: e.processingEnd - e.processingStart });
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
  window.__shown = {};
  window.__watch = (text) => {
    window.__shown[text] = null;
    const check = () => {
      if (window.__shown[text] === null && document.body.innerText.includes(text)) window.__shown[text] = performance.now();
    };
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };
`;

// A new browser for each repetition (an empty HTTP cache and compile cache, as on a first visit), unless `--warm`
// keeps one browser for all of them (the later repetitions then run on a warm browser).
const warm = argv.includes("--warm");
let chrome;
let cdp;
let cookies;
async function launch() {
  chrome = await launchChrome(findChrome());
  cdp = await connect(chrome.webSocketUrl);
  cookies = await signIn(appUrl, users[user]);
  await setUp();
}
async function quit() {
  cdp?.close();
  await chrome?.close();
  chrome = cdp = undefined;
}

async function setUp() {
  await cdp.send("Network.enable");
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.setCookies", { cookies });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVER });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: touch ? 844 : 900, deviceScaleFactor: 1, mobile: touch });
  if (touch) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  if (throttle === "cpu") await cdp.send("Emulation.setCPUThrottlingRate", { rate: MOBILE.cpuSlowdown });
}

const evaluate = async (expression) => {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result?.value;
};

/** Waits until `expression` is truthy; returns the ms it took, or throws after `ms`. */
async function waitFor(expression, what, ms = 15000) {
  const from = Date.now();
  while (Date.now() - from < ms) {
    if (await evaluate(expression)) return Date.now() - from;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const byText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.textContent.trim().includes(${JSON.stringify(text)}) && el.getClientRects().length)`;
const byLabel = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => (el.getAttribute("aria-label") ?? "").includes(${JSON.stringify(text)}) && el.getClientRects().length)`;

async function center(find) {
  const box = await evaluate(`(() => { const el = ${find}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!box) throw new Error(`no element for ${find.slice(0, 120)}`);
  return box;
}

/** Interactions (grouped by Event Timing's interactionId) that began after `since`: each one's slowest event. */
async function interactionsSince(since) {
  const events = await evaluate(`window.__ev.filter((e) => e.s >= ${since})`);
  const groups = new Map();
  for (const event of events) {
    if (!event.id) continue;
    const group = groups.get(event.id) ?? { names: [], d: 0, p: 0 };
    group.names.push(event.n);
    group.d = Math.max(group.d, event.d);
    group.p = Math.max(group.p, event.p);
    groups.set(event.id, group);
  }
  return [...groups.values()];
}

/** Runs `input` (taps, keys), lets the page settle, and returns the slowest interaction it caused, in ms. */
async function measured(input, settleMs = 900) {
  const since = await evaluate("performance.now()");
  await input();
  await sleep(settleMs);
  const interactions = await interactionsSince(since);
  if (debug) console.error("   interactions", JSON.stringify(interactions));
  return interactions.length ? Math.round(Math.max(...interactions.map((i) => i.d))) : 0;
}

async function tap(find) {
  // Taps where the element has stopped moving (a page still settling would shift it under the finger).
  let { x, y } = await center(find);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(150);
    const next = await center(find);
    const steady = Math.abs(next.x - x) < 1 && Math.abs(next.y - y) < 1;
    ({ x, y } = next);
    if (steady) break;
  }
  if (touch) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(60);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await sleep(60);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
}

const press = async (key, text = key.length === 1 ? key : undefined) => {
  const code = key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : "Period") : key;
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : { Escape: 27, Enter: 13 }[key] });
  await sleep(30);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
};

/** Types `text` one key at a time; each key is its own interaction. Returns each key's ms. */
async function typeKeys(text) {
  const times = [];
  for (const key of text) {
    times.push(await measured(() => press(key), 350));
  }
  return times;
}

async function load(path) {
  await cdp.send("Page.navigate", { url: `${appUrl}${path}` });
  await waitFor(`document.readyState === "complete" && document.querySelector("#main-content") !== null`, "the page");
  await waitFor(`document.querySelector('#main-content [aria-busy="true"]') === null`, "the content");
  await sleep(1500);
}

/** The last full month: the seed has about 290 family expenses in each, where this month has only the days so far. */
const LONG_MONTH = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
})();

const QUICK_ADD = touch ? byLabel("button", "Quick add") : `document.querySelector('[aria-label="Application sidebar"] button')`;
const AMOUNT = `document.querySelector('[role="dialog"] input[inputmode="decimal"]')`;

/** Each scenario returns `{ name: ms | ms[] }` for one repetition (a fresh page load). */
const SCENARIOS = {
  "quick-add": async () => {
    await load("/dashboard");
    const first = await measured(() => tap(QUICK_ADD), 1800);
    await waitFor(`${AMOUNT} !== null`, "the amount field");
    await sleep(500);
    await evaluate(`${AMOUNT}.focus()`);
    const keys = await typeKeys("12.50");
    await measured(() => press("Escape"), 700);
    await sleep(700);
    const again = await measured(() => tap(QUICK_ADD), 1200);
    return { "open quick add (first tap)": first, "type an amount (per key)": keys, "open quick add (chunk loaded)": again };
  },
  "month": async () => {
    await load(`/expenses?month=${LONG_MONTH}`);
    const first = await measured(() => tap(byLabel("a, button", "Previous month")), 2500);
    const second = await measured(() => tap(byLabel("a, button", "Previous month")), 2500);
    const back = await measured(() => tap(byLabel("a, button", "Next month")), 2500);
    return { "switch month (first)": first, "switch month (again)": [second, back] };
  },
  "search": async () => {
    await load(`/expenses?month=${LONG_MONTH}`);
    const filters = await measured(() => tap(byText("button", "Filters")), 1500);
    await evaluate(`document.querySelector('#main-content input[aria-label="Search expenses"]').focus()`);
    const keys = await typeKeys("groc");
    return { "open Filters": filters, "type in the search (per key)": keys };
  },
  "reminder-done": async () => {
    await load("/reminders");
    const times = [];
    for (let i = 0; i < 3; i += 1) {
      times.push(await measured(() => tap(`[...document.querySelectorAll('button[aria-label^="Mark "][aria-label$=" done"]')].find((el) => !el.disabled && el.getClientRects().length)`), 1500));
      await sleep(400);
    }
    return { "mark a reminder done": times };
  },
  "todo-drag": async (rep) => {
    await load("/todos");
    // Alternate between two columns so the lab's board keeps cards to move: In progress to Done, then back.
    const [source, destination] = rep % 2 === 0 ? ["in_progress", "done"] : ["done", "in_progress"];
    const card = `document.querySelector('#main-content ul[aria-labelledby="todo-column-${source}"] [data-todo-id]')`;
    const from = await center(card);
    const target = await center(`document.querySelector('#main-content ul[aria-labelledby="todo-column-${destination}"]')`);
    const counts = `[...document.querySelectorAll('#main-content ul[aria-labelledby]')].map((ul) => ul.querySelectorAll("[data-todo-id]").length).join()`;
    const before = await evaluate(counts);
    const down = await measured(async () => {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 });
    }, 500);
    const moving = await measured(async () => {
      for (let step = 1; step <= 12; step += 1) {
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + ((target.x - from.x) * step) / 12, y: from.y + ((target.y - from.y) * step) / 12, button: "left", buttons: 1 });
        await sleep(30);
      }
    }, 300);
    const up = await measured(() => cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 }), 1200);
    const after = await evaluate(counts);
    if (before === after) throw new Error(`the card did not move (${before})`);
    return { "start a drag (press)": down, "drop (release)": up, "drag moves": moving };
  },
  "net-worth": async () => {
    await load("/net-worth");
    // On a phone the sheet is behind the row's `⋯` menu; with a mouse the row has an "Add value" button.
    let menu = null;
    if (touch) {
      menu = await measured(() => tap(byLabel("#main-content button", "More actions")), 1800);
      await waitFor(`${byText('[role="menuitem"]', "Add value")} !== undefined`, "the Add value item");
      await sleep(500);
    }
    const item = await measured(() => tap(touch ? byText('[role="menuitem"]', "Add value") : byLabel("#main-content button", "Add value:")), 1800);
    if (debug) console.error("   dom", await evaluate(`document.querySelectorAll('[role="dialog"]').length + " dialogs; " + document.activeElement?.outerHTML.slice(0, 120)`));
    await waitFor(`${AMOUNT} !== null`, "the value field");
    await sleep(400);
    await evaluate(`${AMOUNT}.focus()`);
    await evaluate(`window.__watch("7,777")`);
    const keys = await typeKeys("7777");
    const save = await measured(() => tap(byText('[role="dialog"] button', "Save value")), 1500);
    const shown = await evaluate(`window.__shown["7,777"]`);
    const tapAt = await evaluate(`window.__ev.filter((e) => e.n === "pointerup" || e.n === "click").at(-1)?.s ?? null`);
    const answered = await evaluate(`performance.getEntriesByType("resource").filter((r) => r.name.includes("/valuations")).at(-1)?.responseEnd ?? null`);
    const result = { ...(menu === null ? {} : { "open the row's menu": menu }), "open the Add value sheet": item, "type a value (per key)": keys, "tap Save value": save };
    if (shown !== null && tapAt !== null) result["list shows the value, ms after the tap"] = Math.round(shown - tapAt);
    if (answered !== null && tapAt !== null) result["server answered, ms after the tap"] = Math.round(answered - tapAt);
    return result;
  },
};

const wanted = option("--scenario", Object.keys(SCENARIOS).join(",")).split(",");
const all = {};
try {
  if (warm) await launch();
  for (const name of wanted) {
    if (!SCENARIOS[name]) throw new Error(`no scenario "${name}"; there are ${Object.keys(SCENARIOS).join(", ")}`);
    const runs = [];
    for (let rep = 0; rep < reps; rep += 1) {
      try {
        if (!warm) await launch();
        runs.push(await SCENARIOS[name](rep));
      } catch (error) {
        console.error(`  ${name} rep ${rep + 1}: ${error.message}`);
      } finally {
        if (!warm) await quit();
      }
    }
    const table = {};
    for (const run of runs) {
      for (const [metric, value] of Object.entries(run)) (table[metric] ??= []).push(...[value].flat());
    }
    all[name] = Object.fromEntries(Object.entries(table).map(([metric, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [metric, { median: median(values), p75: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1)], max: sorted.at(-1), n: values.length }];
    }));
  }
} finally {
  await quit();
}
console.log(JSON.stringify({ label, width, throttle, reps, warm, results: all }, null, 2));
