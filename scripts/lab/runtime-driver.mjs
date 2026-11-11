// The driver of scripts/lab/runtime.sh (PF12). It runs inside a throwaway container that shares the
// app container's network namespace, so the app is on 127.0.0.1:3000, and prints one JSON line per
// phase: health (waits for /health, as deploy.sh does), first (sign in as the lab's parent, then the
// first page), visit (every page and every GET route twice, timed) and load (8 at a time, 15 rounds).
import { readFileSync } from "node:fs";
const BASE = "http://127.0.0.1:3000";
const phase = process.argv[2];
const now = () => performance.now();
async function timed(path, init = {}) {
  const t = now();
  let status = 0;
  try {
    const r = await fetch(BASE + path, init);
    await r.arrayBuffer();
    status = r.status;
    return { path, status, ms: Math.round(now() - t) };
  } catch (e) {
    return { path, status: "ERR " + e.message, ms: Math.round(now() - t) };
  }
}
async function signIn() {
  const users = JSON.parse(readFileSync("/data/users.json", "utf8")).users;
  const a = users.parent;
  const t = now();
  const r = await fetch(BASE + "/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ mode: "login", email: a.signIn, password: a.password }),
  });
  await r.arrayBuffer();
  if (!r.ok) throw new Error(`sign-in answered ${r.status}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
  return { status: r.status, ms: Math.round(now() - t), cookie };
}
const PAGES = ["/dashboard", "/", "/expenses", "/expenses?member=all", "/expenses/import", "/insights", "/investments", "/todos", "/reminders", "/calendar", "/net-worth", "/more", "/settings", "/settings/ai", "/settings/family", "/settings/family/manage", "/settings/mcp", "/settings/notifications", "/settings/permissions", "/change-password", "/offline", "/nope-not-a-page"];
const APIS = ["/api/account", "/api/account/notices", "/api/dashboard", "/api/expenses", "/api/expense-tabs", "/api/expenses/suggestions?q=a", "/api/family", "/api/investments", "/api/net-worth", "/api/reminders", "/api/reminders/summary", "/api/todos", "/api/calendar/events", "/api/notifications/settings", "/api/notifications/push-key", "/api/account/mcp", "/api/account/mcp/apps", "/api/account/mcp/tokens"];
if (phase === "health") {
  for (let i = 0; i < 300; i++) {
    const r = await timed("/health");
    if (r.status === 200) { console.log(JSON.stringify({ health: r.ms })); process.exit(0); }
    await new Promise((s) => setTimeout(s, 100));
  }
  process.exit(1);
} else if (phase === "first") {
  const s = await signIn();
  const d = await timed("/dashboard", { headers: { cookie: s.cookie } });
  console.log(JSON.stringify({ signIn: s.ms, signInStatus: s.status, dashboard: d.ms, dashboardStatus: d.status }));
} else if (phase === "visit") {
  const s = await signIn();
  const sweeps = [];
  for (let n = 0; n < 2; n++) {
    const rows = [];
    for (const p of [...PAGES, ...APIS]) rows.push(await timed(p, { headers: { cookie: s.cookie } }));
    sweeps.push(rows);
  }
  const sum = (rows) => rows.reduce((a, r) => a + r.ms, 0);
  const slow = [...sweeps[0]].sort((a, b) => b.ms - a.ms).slice(0, 3).map((r) => `${r.path}=${r.ms}`);
  console.log(JSON.stringify({ firstSweepMs: sum(sweeps[0]), secondSweepMs: sum(sweeps[1]), requests: sweeps[0].length, slowest: slow, non200: sweeps[0].filter((r) => r.status !== 200).map((r) => `${r.path}=${r.status}`)}));
} else if (phase === "load") {
  const s = await signIn();
  const all = [...PAGES, ...APIS];
  const t = now();
  let n = 0, bad = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let k = 0; k < 15; k++) for (const p of all) { const r = await timed(p, { headers: { cookie: s.cookie } }); n++; if (typeof r.status === "string") bad++; }
  }));
  console.log(JSON.stringify({ requests: n, transportErrors: bad, seconds: Math.round((now() - t) / 1000) }));
}
