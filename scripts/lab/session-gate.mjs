// PF5's check of the session gate in the lab (docs/lab.md, docs/performance.md "PF5").
//
//   node scripts/lab/session-gate.mjs [--writes] [--width 390]
//
// Loads every signed-in section cold in a headless Chromium, once per case, and prints one JSON line
// per load: where the browser ended up, every document answer on the way (status and path), how many
// scripts it downloaded and whether any came from the signed-in app's own chunks, `/api/account`
// requests, and every console error and warning (React's hydration errors, CSP report-only
// violations). The read-only cases:
//   - signed out: each section and `/`;
//   - the seed's parent and kid: each section;
//   - a damaged session cookie (what an expired, unrefreshable session looks like to the server);
//   - a session ended elsewhere ("Sign out everywhere" from a second sign-in);
//   - signing out and in as the kid in the same tab, through the screens (at 390 px, where More has
//     the sign-out button): it ends on the kid's More page, naming the kid.
// With `--writes` it also changes the lab's data (never anything else: it only talks to
// http://localhost:3110, and the lab's guard keeps that app on the lab database):
//   - a kid whose password a parent reset (a kid's first sign-in) is sent to /change-password, and
//     gets in after choosing one (the kid's password is then the seed's again);
//   - a member removed from the family (Sam) still gets in, with no family;
//   - a deleted account (Casey, the user without a family) is sent to sign in.
// Run `--writes` last: after it, Sam has no family and Casey no account (`npm run lab -- down`, `up`).
import { readFileSync } from "node:fs";

import { guardProblems, parseEnvFile } from "./guard.mjs";
import { connect, cookieHeader, findChrome, launchChrome, signIn as labSignIn } from "./measure.mjs";

const REPO = new URL("../../", import.meta.url).pathname;
const problems = guardProblems(parseEnvFile(readFileSync(`${REPO}/.lab/app.env`, "utf8")));
if (problems.length) throw new Error(`refusing: ${problems.join("; ")}`);

const args = process.argv.slice(2);
const writes = args.includes("--writes");
const width = Number(args.includes("--width") ? args[args.indexOf("--width") + 1] : 1280);
const appUrl = "http://localhost:3110";
const SECTIONS = ["/dashboard", "/expenses", "/insights", "/investments", "/net-worth", "/todos", "/reminders", "/calendar", "/settings", "/more"];
const users = JSON.parse(readFileSync(`${REPO}/.lab/users.json`, "utf8")).users;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const signIn = (signInName, password) => labSignIn(appUrl, { signIn: signInName, password });

/** Calls the app's API with `cookies`, as the browser would. */
async function call(cookies, method, path, body) {
  const response = await fetch(`${appUrl}${path}`, {
    method,
    headers: { cookie: cookieHeader(cookies), origin: appUrl, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

const chrome = await launchChrome(findChrome());
try {
  const { send, on, close } = await connect(chrome.webSocketUrl);
  // Undefined while a full page load replaces the document (signing in and out are full loads).
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true }).catch(() => null))?.result?.value;

  await Promise.all([send("Network.enable"), send("Page.enable"), send("Runtime.enable"), send("Log.enable")]);
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });

  let load = null;
  on("Network.responseReceived", ({ type, response }) => {
    if (!load) return;
    const url = new URL(response.url);
    if (type === "Document") load.documents.push(`${response.status} ${url.pathname}${url.search}`);
    if (type === "Script") {
      load.scripts += 1;
      if (/\/app\/\(app\)\//.test(decodeURIComponent(url.pathname))) load.appChunks += 1;
    }
    if (url.pathname === "/api/account") load.accountRequests += 1;
  });
  on("Network.requestWillBeSent", ({ type, redirectResponse }) => {
    if (load && type === "Document" && redirectResponse) {
      const url = new URL(redirectResponse.url);
      load.documents.push(`${redirectResponse.status} ${url.pathname}${url.search}`);
    }
  });
  on("Runtime.consoleAPICalled", ({ type, args: values }) => {
    if (load && (type === "error" || type === "warning")) load.console.push(`${type}: ${values.map((value) => value.value ?? value.description ?? "").join(" ").slice(0, 300)}`);
  });
  on("Runtime.exceptionThrown", ({ exceptionDetails }) => load?.console.push(`exception: ${(exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 300)}`));
  on("Log.entryAdded", ({ entry }) => {
    if (load && (entry.level === "error" || entry.level === "warning")) load.console.push(`${entry.source} ${entry.level}: ${entry.text.slice(0, 300)}`);
  });

  /** One cold load of `path` with exactly `cookies`, waiting until the page has settled. */
  async function visit(label, path, cookies) {
    await send("Network.clearBrowserCookies");
    if (cookies.length) await send("Network.setCookies", { cookies });
    load = { label, path, documents: [], scripts: 0, appChunks: 0, accountRequests: 0, console: [] };
    await send("Page.navigate", { url: appUrl + path });
    // Settled: the URL and the number of busy placeholders unchanged for 1.5 s (at most 20 s).
    let last = "";
    for (let waited = 0, still = 0; waited < 20000 && still < 1500; waited += 250) {
      await sleep(250);
      const now = await evaluate(`location.pathname + location.search + "|" + document.querySelectorAll('[aria-busy="true"]').length + "|" + document.readyState`);
      still = now === last ? still + 250 : 0;
      last = now;
    }
    const page = await evaluate(`({ url: location.pathname + location.search, h1: document.querySelector("h1")?.textContent ?? null, signedInAs: document.body.innerText.match(/[\\w.]+@lab\\.test|robin\\.lab/)?.[0] ?? null, dialog: document.querySelector('[role="dialog"], [role="alertdialog"]')?.textContent?.slice(0, 120) ?? null })`);
    const result = { ...load, ...page };
    load = null;
    console.log(JSON.stringify(result));
    return result;
  }

  const signedOut = [];
  for (const path of [...SECTIONS, "/"]) await visit("signed out", path, signedOut);
  const parent = await signIn(users.parent.signIn, users.parent.password);
  for (const path of SECTIONS) await visit("parent", path, parent);
  const kid = await signIn(users.kid.signIn, users.kid.password);
  for (const path of SECTIONS) await visit("kid", path, kid);

  // A session cookie the server can't use: what an expired session whose refresh failed looks like.
  const damaged = parent.map((cookie) => (cookie.name.includes("auth-token") ? { ...cookie, value: `${cookie.value.slice(0, -12)}AAAAAAAAAAAA` } : cookie));
  await visit("damaged session cookie", "/expenses?month=2026-10", damaged);

  // A session ended from another device: sign in twice, sign out everywhere from the second.
  const first = await signIn(users.adult.signIn, users.adult.password);
  const second = await signIn(users.adult.signIn, users.adult.password);
  await call(second, "DELETE", "/api/auth?scope=global");
  await visit("session ended elsewhere", "/todos", first);

  // Signing out and in as someone else in the same tab, with the app's own buttons: the shell must show
  // the new person, and nothing the router prefetched while signed out (a redirect to sign in) may be
  // followed (that bounced between /login and /dashboard before both became full page loads). Through
  // More's "Sign out" row, which only phones have (from 768 px More opens Settings).
  if (width < 768) {
    await visit("switch person in one tab: parent", "/more", await signIn(users.parent.signIn, users.parent.password));
    const clickText = (text) => evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === ${JSON.stringify(text)}); b?.click(); return Boolean(b); })()`);
    const waitForPath = async (path) => { for (let i = 0; i < 80; i++) { if ((await evaluate("location.pathname")) === path) return true; await sleep(250); } return false; };
    await clickText("Sign out");
    await sleep(500);
    await clickText("Yes, log me out");
    await waitForPath("/login");
    for (let i = 0; i < 40 && !(await evaluate(`Boolean(document.querySelector('input[name="password"]'))`)); i++) await sleep(250);
    for (const [name, value] of [["email", users.kid.signIn], ["password", users.kid.password]]) {
      await evaluate(`document.querySelector('input[name="${name}"]').focus()`);
      await send("Input.insertText", { text: value });
    }
    await evaluate(`document.querySelector('form button[type="submit"]').click()`);
    const arrived = await waitForPath("/dashboard");
    // Tap More until the page has hydrated enough to follow it (an early click can be lost).
    for (let i = 0; i < 20 && (await evaluate("location.pathname")) !== "/more"; i++) {
      await evaluate(`[...document.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/more")?.click()`);
      await sleep(500);
    }
    await sleep(1500);
    console.log(JSON.stringify({ label: "switch person in one tab: then the kid", arrived, url: await evaluate("location.pathname"), signedInAs: await evaluate(`document.body.innerText.match(/[\\w.]+@lab\\.test|robin\\.lab/)?.[0] ?? null`) }));
  }

  if (writes) {
    const { family } = await call(parent, "GET", "/api/family");
    const memberId = (key) => family.members.find((entry) => entry.displayName === users[key].displayName).memberId;

    // A kid's first sign-in: a parent sets a temporary password; the kid signs in with it.
    const temporary = `Temp-${Math.random().toString(36).slice(2, 10)}-pass`;
    await call(parent, "POST", `/api/family/members/${memberId("kid")}/password`, { password: temporary });
    const kidFirst = await signIn(users.kid.signIn, temporary);
    await visit("kid, first sign-in (must change password)", "/dashboard", kidFirst);
    await visit("kid, first sign-in (must change password)", "/reminders", kidFirst);
    await call(kidFirst, "POST", "/api/account/password", { currentPassword: temporary, password: users.kid.password });
    await visit("kid, after choosing a password", "/dashboard", await signIn(users.kid.signIn, users.kid.password));

    // A member removed from the family.
    const sam = await signIn(users.adult.signIn, users.adult.password);
    await call(parent, "DELETE", `/api/family/members/${memberId("adult")}`);
    await visit("member removed from the family", "/dashboard", sam);

    // A deleted account, visiting with the cookies it had.
    const casey = await signIn(users.solo.signIn, users.solo.password);
    await visit("solo user, before deleting", "/dashboard", casey);
    await call(casey, "DELETE", "/api/account", { currentPassword: users.solo.password, confirm: "delete my account" });
    await visit("deleted account", "/dashboard", casey);
  }
  close();
} finally {
  await chrome.close();
}
