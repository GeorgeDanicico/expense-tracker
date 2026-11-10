#!/usr/bin/env node
// PF4's search check (docs/performance.md, PF4): records the tab ledger's answer (the expense ids, in
// order) to 43 searches, with and without a year filter, on two tabs: a tab of all of the parent's
// expenses, and a tab of awkward descriptions it adds to the solo user with the lab's secret key.
// Run it on two builds and `diff` the JSON. Lab only.
//
//   node scripts/lab/search-compare.mjs [.lab] > search.json
import { readFileSync } from "node:fs";

import { guardProblems, parseEnvFile } from "./guard.mjs";

const [labDir = ".lab"] = process.argv.slice(2);
const APP = "http://localhost:3110";
const { users } = JSON.parse(readFileSync(`${labDir}/users.json`, "utf8"));
const env = parseEnvFile(readFileSync(`${labDir}/app.env`, "utf8"));
// Only the lab: refuse an env file that points anywhere but this machine (docs/lab.md).
const problems = guardProblems(env);
if (problems.length) throw new Error(`refusing: ${problems.join("; ")}`);
const ALL = ["housing", "groceries", "transport", "car", "utilities", "health", "entertainment", "shopping", "education", "travel", "other"];

async function session(account) {
  const response = await fetch(`${APP}/api/auth`, { method: "POST", headers: { "content-type": "application/json", origin: APP }, body: JSON.stringify({ mode: "login", email: account.signIn, password: account.password }) });
  if (!response.ok) throw new Error(`sign-in ${response.status}`);
  const cookie = response.headers.getSetCookie().map((h) => h.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
  return (method, path, body) => fetch(`${APP}${path}`, { method, headers: { cookie, origin: APP, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
}

async function everythingTab(call) {
  const { tabs } = await (await call("GET", "/api/expense-tabs")).json();
  const found = tabs.find((tab) => tab.name === "Everything (PF4 probe)");
  if (found) return found.id;
  const created = await (await call("POST", "/api/expense-tabs", { name: "Everything (PF4 probe)", categoryKeys: ALL, subtypeKeys: [] })).json();
  return created.tab.id;
}

const AWKWARD = ["100% cotton", "100 percent", "a_b", "axb", "back\\slash", "star*shop", "starXshop", "comma, paren (x)", "quote \"q\"", "ŞTIRBEI Ștefan", "plain", "dot.ted", "colon: yes", "İstanbul", "Straße"];

async function seedSolo() {
  const rest = `${env.LAB_SUPABASE_DIRECT_URL}/rest/v1/expenses`;
  const headers = { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" };
  const existing = await (await fetch(`${rest}?select=id&user_id=eq.${users.solo.userId}`, { headers })).json();
  if (existing.length) return;
  const rows = AWKWARD.map((description, index) => ({ user_id: users.solo.userId, description, amount: index + 1, category: ALL[index % ALL.length], subtype: null, expense_date: `2026-10-${String(index + 1).padStart(2, "0")}`, notes: index % 3 === 0 ? `note ${description}` : null }));
  rows.push({ user_id: users.solo.userId, description: "fuel", amount: 3, category: "car", subtype: "car_fuel", expense_date: "2026-10-20", notes: null });
  const response = await fetch(rest, { method: "POST", headers, body: JSON.stringify(rows) });
  if (!response.ok) throw new Error(`seed solo ${response.status} ${await response.text()}`);
}

const TERMS = ["", "a", "e", "zzz", "Lidl", "lidl", "MEGA", "rent", "fuel", "Fuel", "groc", "Groceries", "car", "no sub", "No subtype", "subtype", "repairs", "%", "_", "\\", "*", "r*s", "100%", "a_b", "back\\s", ",", "(x)", "\"q\"", "ștefan", "ŞTIRBEI", ".", "dot.ted", ":", "colon: y", "istanbul", "straße", "STRASSE", "note", "  padded  ", "Entertainment", "health", "travel", "eat"];

const results = {};
for (const [who, setup] of [["parent", null], ["solo", seedSolo]]) {
  if (setup) await setup();
  const call = await session(users[who]);
  const tabId = await everythingTab(call);
  for (const term of TERMS) {
    for (const scope of ["", "&scope=year&year=2025"]) {
      const query = `?search=${encodeURIComponent(term)}${scope}`;
      const response = await call("GET", `/api/expense-tabs/${tabId}/expenses${query}`);
      const body = await response.json();
      results[`${who} ${JSON.stringify(term)}${scope}`] = response.ok ? { status: response.status, count: body.expenses.length, ids: body.expenses.map((e) => e.id), total: body.total ?? body.totalAmount ?? null } : { status: response.status, error: body.error };
    }
  }
}
process.stdout.write(`${JSON.stringify(results, null, 1)}\n`);
process.stderr.write(Object.entries(results).filter(([k]) => !k.includes("scope")).map(([k, v]) => `${k}: ${v.count ?? v.error}`).join("\n") + "\n");
