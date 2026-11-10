#!/usr/bin/env node
// PF4's route probe (docs/performance.md, PF4): signs in to the lab as a seed user and calls each
// route `runs` times, one at a time, then reads the app's request line (.lab/app.log) and the delay
// proxy's calls (.lab/supabase-calls.jsonl) for each call. Prints the medians as JSON on stdout and
// one line per route on stderr. Some routes write (a calendar event's title, a to-do's title and
// place): only ever run it against the lab. Expects the tab "Everything (PF4 probe)" that
// scripts/lab/search-compare.mjs creates; run that first.
//
//   node scripts/lab/route-probe.mjs [.lab] [parent] [5] > routes.json
import { readFileSync, statSync } from "node:fs";

import { guardProblems, parseEnvFile } from "./guard.mjs";

const [labDir = ".lab", userName = "parent", runsArg = "5"] = process.argv.slice(2);
const runs = Number(runsArg);
// Only the lab: refuse an env file that points anywhere but this machine (docs/lab.md).
const problems = guardProblems(parseEnvFile(readFileSync(`${labDir}/app.env`, "utf8")));
if (problems.length) throw new Error(`refusing: ${problems.join("; ")}`);

const APP = "http://localhost:3110";
const users = JSON.parse(readFileSync(`${labDir}/users.json`, "utf8")).users;
const account = users[userName];

async function signIn() {
  const response = await fetch(`${APP}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify({ mode: "login", email: account.signIn, password: account.password }),
  });
  if (!response.ok) throw new Error(`sign-in ${response.status}`);
  return response.headers.getSetCookie().map((h) => h.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
}

const cookie = await signIn();
const call = (method, path, body) => fetch(`${APP}${path}`, {
  method,
  headers: { cookie, origin: APP, ...(body ? { "content-type": "application/json" } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const getJson = async (path) => (await call("GET", path)).json();

const size = (path) => statSync(path).size;
const readFrom = (path, offset) => readFileSync(path).subarray(offset).toString("utf8");
const jsonLines = (text) => text.split("\n").filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

async function measure(label, method, path, body) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const appAt = size(`${labDir}/app.log`);
    const proxyAt = size(`${labDir}/supabase-calls.jsonl`);
    const started = performance.now();
    const response = await call(method, typeof path === "function" ? path(i) : path, typeof body === "function" ? body(i) : body);
    const text = await response.text();
    const wall = performance.now() - started;
    await new Promise((r) => setTimeout(r, 400)); // let the background last-active write and log flush
    const lines = jsonLines(readFrom(`${labDir}/app.log`, appAt)).filter((l) => l.event === "request");
    const proxy = jsonLines(readFrom(`${labDir}/supabase-calls.jsonl`, proxyAt));
    const line = lines.find((l) => l.route !== "/api/client-log") ?? {};
    samples.push({
      status: response.status, bytes: text.length, wallMs: Math.round(wall), ms: line.ms, dbCalls: line.dbCalls, dbMs: line.dbMs,
      authCalls: proxy.filter((c) => c.api === "auth").length,
      supabaseCalls: proxy.filter((c) => !(c.api === "rpc" && c.name === "touch_last_active")).length,
      getFamily: proxy.filter((c) => c.api === "rpc" && c.name === "get_family").length,
      getMembership: proxy.filter((c) => c.api === "rpc" && c.name === "get_my_membership").length,
      profiles: proxy.filter((c) => c.api === "rest" && c.name === "profiles").length,
      spans: line.spans?.map((s) => `${s.name}${s.count ? `x${s.count}` : ""}`).join(" "),
      error: response.status >= 400 ? text.slice(0, 200) : undefined,
    });
  }
  const med = (key) => { const v = samples.map((s) => s[key]).filter((x) => typeof x === "number").sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const out = { label, method, status: samples[0].status, ms: med("ms"), dbCalls: med("dbCalls"), dbMs: med("dbMs"), authCalls: med("authCalls"), supabaseCalls: med("supabaseCalls"), getFamily: med("getFamily"), getMembership: med("getMembership"), profiles: med("profiles"), bytes: med("bytes"), spans: samples[0].spans, error: samples[0].error };
  process.stderr.write(`${JSON.stringify(out)}\n`);
  return out;
}

// Ids from the seed.
const todos = (await getJson("/api/todos")).todos;
const open = todos.filter((t) => t.status === "todo");
const now = new Date();
const from = new Date(now.getTime() - 40 * 86400e3).toISOString();
const to = new Date(now.getTime() + 40 * 86400e3).toISOString();
const events = (await getJson(`/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).events;
const series = events.find((e) => e.seriesLength > 1);
const single = events.find((e) => e.seriesLength === 1);
const tabs = (await getJson("/api/expense-tabs")).tabs;
const tab = tabs.find((t) => t.name !== "Everything (PF4 probe)");
const everything = tabs.find((t) => t.name === "Everything (PF4 probe)");
const family = (await getJson("/api/family")).family;
const otherMember = family.members.find((m) => m.userId !== account.userId);

const results = [];
const m = async (...args) => results.push(await measure(...args));
// The four target pages' API routes.
await m("account", "GET", "/api/account");
await m("dashboard", "GET", "/api/dashboard");
await m("expenses", "GET", "/api/expenses");
await m("expense-tabs", "GET", "/api/expense-tabs");
await m("family", "GET", "/api/family");
await m("todos", "GET", "/api/todos");
await m("reminders", "GET", "/api/reminders");
await m("reminders/summary", "GET", "/api/reminders/summary");
await m("account/notices", "GET", "/api/account/notices");
// Member views and family-wide views.
await m("dashboard ?member=other", "GET", `/api/dashboard?member=${otherMember.memberId}`);
await m("dashboard ?member=all", "GET", "/api/dashboard?member=all");
await m("expenses ?member=all", "GET", "/api/expenses?member=all");
// Search and tab ledger.
await m("tab ledger, all", "GET", `/api/expense-tabs/${tab.id}/expenses`);
await m("tab ledger, search 'a'", "GET", `/api/expense-tabs/${tab.id}/expenses?search=a`);
await m("tab ledger, search 'zzz'", "GET", `/api/expense-tabs/${tab.id}/expenses?search=zzz`);
await m("Everything tab, all", "GET", `/api/expense-tabs/${everything.id}/expenses`);
await m("Everything tab, search 'fuel'", "GET", `/api/expense-tabs/${everything.id}/expenses?search=fuel`);
await m("Everything tab, search 'zzz'", "GET", `/api/expense-tabs/${everything.id}/expenses?search=zzz`);
await m("Everything tab, search 'groc'", "GET", `/api/expense-tabs/${everything.id}/expenses?search=groc`);
// Calendar and to-dos.
await m("calendar list", "GET", `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
await m("calendar get", "GET", `/api/calendar/events/${single.id}`);
await m("calendar PATCH this", "PATCH", `/api/calendar/events/${single.id}`, (i) => ({ title: `Probe ${i}` }));
await m("calendar PATCH all (series)", "PATCH", `/api/calendar/events/${series.id}`, (i) => ({ scope: "all", notes: `Probe ${i}` }));
await m("todo PATCH", "PATCH", `/api/todos/${open[0].id}`, (i) => ({ title: `Probe ${i}` }));
await m("todo move", "POST", `/api/todos/${open[0].id}/move`, (i) => (i % 2 === 0
  ? { status: "todo", beforeId: open[2].id, afterId: open[3].id }
  : { status: "todo", beforeId: null, afterId: open[1].id }));
// Investments and net worth.
await m("investments", "GET", "/api/investments");
await m("net-worth", "GET", "/api/net-worth");
await m("imports", "GET", "/api/imports");

process.stdout.write(`${JSON.stringify(results, null, 1)}\n`);
