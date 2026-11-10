#!/usr/bin/env node
// Seeds the lab with a fake family (docs/lab.md). Run by `scripts/lab.sh up`, never by hand.
//
//   node scripts/lab/seed.mjs <lab env file> <users file to write>
//
// Every row goes in the way the app writes it, with one exception (the profiles, below):
//   - Accounts: the local Auth admin API, confirmed, as `AuthAdmin.createUser` does
//     (src/lib/supabase/auth-admin.ts).
//   - Their `profiles` row: written by the database owner, the way the live project's signup trigger
//     writes it (the legacy `handle_new_user` isn't in the migrations, so the lab has no trigger).
//     Not with the secret key as `AuthAdmin.createUser` does: since the AI gate migration
//     (20261030000100) an insert into `profiles` by `service_role` fails with "permission denied for
//     function my_kid_ai_permitted" (docs/lab.md, "What the lab found"). So the kid is made the way
//     POST /api/family/kids would make it if that worked: account, profile, then the parent calls
//     `add_managed_kid` (the same SQL function the route calls), then the kid signs in through the
//     app and chooses a new password through the app.
//   - The family, the second parent, colours, tabs, reminders, to-dos, calendar events,
//     investments and net worth: the app's own API routes, signed in as the user, through the
//     running lab app. Same validation, same services, same SQL functions as a person using the app.
//   - Expenses: about 6,000 of them, too many for the API's 120 writes a minute, so they are
//     inserted into `expenses` through PostgREST as their owner (row level security applies and the
//     merchant trigger runs), with the columns `toExpenseWrite` writes.
//
// Deterministic: one fixed random seed, and every date counted from "today" in Europe/Bucharest.
// The passwords are the only random part: generated here, written to the users file (mode 600,
// git-ignored), never printed.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { guardProblems, parseEnvFile } from "./guard.mjs";

export const TIME_ZONE = "Europe/Bucharest";
export const SEED = 16;

/** A small, fast, seedable random generator (mulberry32). Same seed, same numbers. */
export function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    amount: (min, max) => Math.round((min + next() * (max - min)) * 100) / 100,
  };
}

/** Today's date in Bucharest, `YYYY-MM-DD`. */
export function bucharestToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (date) => date.toISOString().slice(0, 10);
export const addDays = (iso, days) => toIso(new Date(toDate(iso).getTime() + days * 86_400_000));

/** The first day of the month `offset` months from `iso`'s month. */
export function monthStart(iso, offset = 0) {
  const date = toDate(iso);
  return toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)));
}

const daysInMonth = (firstDay) => {
  const date = toDate(firstDay);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
};

/** The family. Obviously fake names; adults have `@lab.test` emails, the kid a username like the app gives kids. */
export const PEOPLE = {
  parent: { displayName: "Alex Example", email: "alex.parent@lab.test" },
  adult: { displayName: "Sam Example", email: "sam.adult@lab.test" },
  kid: { displayName: "Robin Example", username: "robin.lab", email: "robin.lab@kids.ifam.invalid" },
  solo: { displayName: "Casey Solo", email: "casey.solo@lab.test" },
};
export const FAMILY_NAME = "The Example Family";
/** The kid may add expenses and nothing else (no family finance, investments, net worth, MCP or AI). */
export const KID_PERMISSIONS = { expenses: "edit", investments: "off", net_worth: "off", family_finance: "off", mcp: "off", ai: "off" };

/** What each category's expenses look like: descriptions, an amount range and how often they come up. */
const CATEGORY_SHAPES = [
  { category: "groceries", weight: 30, min: 15, max: 420, descriptions: ["Corner grocery", "Weekly shop", "Farmers market", "Bakery", "Supermarket run"] },
  { category: "transport", weight: 10, min: 4, max: 60, descriptions: ["Metro card top-up", "Taxi ride", "Bus ticket", "Parking"] },
  { category: "car", weight: 8, min: 80, max: 900, descriptions: ["Fuel station", "Car wash", "Oil change", "Tyre service"], subtypes: ["car_fuel", "car_fuel", "car_maintenance", "car_repairs"] },
  { category: "utilities", weight: 5, min: 60, max: 450, descriptions: ["Electricity bill", "Gas bill", "Internet", "Phone plan", "Water bill"] },
  { category: "health", weight: 5, min: 20, max: 600, descriptions: ["Pharmacy", "Dentist", "Eye test", "Clinic visit"] },
  { category: "entertainment", weight: 10, min: 15, max: 250, descriptions: ["Cinema", "Concert tickets", "Streaming service", "Board game cafe", "Bowling"] },
  { category: "shopping", weight: 14, min: 20, max: 700, descriptions: ["Bookshop", "Clothes", "Hardware store", "Online order", "Shoes"] },
  { category: "education", weight: 3, min: 30, max: 900, descriptions: ["School supplies", "Language course", "Swimming lessons"] },
  { category: "travel", weight: 3, min: 150, max: 2500, descriptions: ["Train tickets", "Weekend hotel", "Flight", "Mountain cabin"] },
  { category: "other", weight: 7, min: 5, max: 200, descriptions: ["Gift", "Haircut", "Post office", "Donation", "Dry cleaning"] },
];
const TOTAL_WEIGHT = CATEGORY_SHAPES.reduce((sum, shape) => sum + shape.weight, 0);

function pickShape(random) {
  let roll = random.next() * TOTAL_WEIGHT;
  for (const shape of CATEGORY_SHAPES) {
    roll -= shape.weight;
    if (roll < 0) return shape;
  }
  return CATEGORY_SHAPES[0];
}

/**
 * How many everyday expenses a person adds in the month `monthsAgo` months back: `recent` in the
 * last three months, fewer the further back (a family that started using the app gradually).
 */
export function monthlyCount(recent, monthsAgo) {
  if (monthsAgo < 3) return recent;
  return Math.max(10, Math.round(recent * (1 - (monthsAgo - 2) / 50)));
}

/**
 * About three years of expenses for one person, newest month first, as the rows
 * `toExpenseWrite` writes (without `user_id`). The current month stops at today.
 *   recent: everyday expenses a month in the last three months
 *   months: how many months back to go (36 is three years)
 *   fixed:  monthly bills on fixed days ({ day, description, category, amount })
 */
export function generateExpenses(random, { today, recent, months, fixed = [] }) {
  const rows = [];
  for (let monthsAgo = 0; monthsAgo < months; monthsAgo += 1) {
    const first = monthStart(today, -monthsAgo);
    const lastDay = monthsAgo === 0 ? Number(today.slice(8, 10)) : daysInMonth(first);
    const share = lastDay / daysInMonth(first);
    for (const bill of fixed) {
      if (bill.day > lastDay) continue;
      rows.push({ description: bill.description, amount: bill.amount, category: bill.category, subtype: null, expense_date: addDays(first, bill.day - 1), notes: null });
    }
    const count = Math.round(monthlyCount(recent, monthsAgo) * share);
    for (let index = 0; index < count; index += 1) {
      const shape = pickShape(random);
      const which = random.int(0, shape.descriptions.length - 1);
      rows.push({
        description: shape.descriptions[which],
        amount: random.amount(shape.min, shape.max),
        category: shape.category,
        subtype: shape.subtypes ? shape.subtypes[which] : null,
        expense_date: addDays(first, random.int(0, lastDay - 1)),
        notes: random.next() < 0.08 ? "Split with the family" : null,
      });
    }
  }
  return rows;
}

/** Everyone's expenses. Alex pays the bills; Sam and Robin add everyday spending. */
export function expensePlan(today) {
  const random = createRandom(SEED);
  return {
    parent: generateExpenses(random, {
      today, recent: 150, months: 36,
      fixed: [
        { day: 1, description: "Rent", category: "housing", amount: 2600 },
        { day: 5, description: "Electricity bill", category: "utilities", amount: 240.5 },
        { day: 12, description: "Internet", category: "utilities", amount: 55 },
      ],
    }),
    adult: generateExpenses(random, { today, recent: 110, months: 36 }),
    kid: generateExpenses(random, { today, recent: 25, months: 12 }),
  };
}

/** Reminders as POST /api/reminders takes them: due and overdue today, upcoming, repeating, one with an expense. */
export function reminderPlan(today) {
  return {
    parent: [
      { title: "Pay the rent", startsOn: monthStart(today, 1), repeatUnit: "month", timeOfDay: "09:00", expenseTemplate: { amount: 2600, currency: "RON", category: "housing", subtype: null } },
      { title: "Water the plants", startsOn: today, repeatUnit: "week", timeOfDay: "08:00" },
      { title: "Call the plumber", startsOn: addDays(today, -3), timeOfDay: "10:00" },
      { title: "Renew the car insurance", startsOn: addDays(today, -1), timeOfDay: "18:00" },
      { title: "Book the dentist", startsOn: today, timeOfDay: "07:30" },
      { title: "Pay the electricity bill", startsOn: addDays(today, 4), repeatUnit: "month", timeOfDay: "09:00" },
      { title: "Take the bins out", startsOn: addDays(today, 1), repeatUnit: "week", timeOfDay: "20:00" },
      { title: "School trip money", startsOn: addDays(today, 6), timeOfDay: "08:00" },
      { title: "Change the smoke alarm battery", startsOn: addDays(today, 30), repeatUnit: "year", timeOfDay: "11:00" },
      { title: "Return the library books", startsOn: addDays(today, -10), timeOfDay: "12:00", done: true },
    ],
    adult: [
      { title: "Pick up the dry cleaning", startsOn: today, timeOfDay: "17:00" },
      { title: "Gym membership", startsOn: addDays(today, 9), repeatUnit: "month", timeOfDay: "09:00" },
      { title: "Send the birthday card", startsOn: addDays(today, -2), timeOfDay: "09:00" },
    ],
    kid: [
      { title: "Homework: maths", startsOn: today, repeatUnit: "week", timeOfDay: "16:00" },
      { title: "Football practice kit", startsOn: addDays(today, 2), repeatUnit: "week", timeOfDay: "07:00" },
    ],
    solo: [
      { title: "Renew the passport", startsOn: addDays(today, 3), timeOfDay: "09:00" },
    ],
  };
}

/** The family's to-do board as POST /api/todos takes it, with who it's assigned to (a PEOPLE key or null). */
export function todoPlan(today) {
  const open = [
    ["Fix the leaking tap", "parent", "todo", 2], ["Buy a birthday present for Robin", "adult", "todo", 5],
    ["Tidy the bedroom", "kid", "todo", 0], ["Plan the summer holiday", "parent", "in_progress", null],
    ["Sort the winter clothes", "adult", "in_progress", 3], ["Clean the car", "kid", "todo", 1],
    ["Call grandma", null, "todo", null], ["Paint the fence", "parent", "todo", 14],
    ["Organise the garage", "adult", "todo", null], ["Read the school newsletter", "kid", "in_progress", -1],
    ["Change the bed sheets", null, "todo", 0], ["Book the car service", "parent", "todo", -2],
    ["Bake for the school fair", "adult", "todo", 6], ["Practise piano", "kid", "todo", null],
  ];
  const done = [
    "Pay the parking fine", "Order new glasses", "Return the parcel", "Clean the fridge",
    "Fix the bike tyre", "Hang the picture", "Renew the gym card", "Recycle the batteries",
  ];
  return [
    ...open.map(([title, assignee, status, dueIn]) => ({ title, assignee, status, dueDate: dueIn === null ? null : addDays(today, dueIn) })),
    ...done.map((title, index) => ({ title, assignee: ["parent", "adult", "kid", null][index % 4], status: "done", dueDate: null })),
  ];
}

/** Calendar events around today as POST /api/calendar/events takes them, attendees as PEOPLE keys. */
export function calendarPlan(today) {
  return [
    { title: "Parents' evening", startDate: addDays(today, 2), startTime: "18:00", endTime: "19:30", attendees: ["parent", "adult"] },
    { title: "Football match", startDate: addDays(today, 5), startTime: "10:00", endTime: "11:30", attendees: ["kid", "parent"] },
    { title: "Dinner with friends", startDate: addDays(today, -4), startTime: "19:00", endTime: "22:00", attendees: ["parent", "adult"] },
    { title: "Swimming lesson", startDate: addDays(today, -6), startTime: "17:00", endTime: "18:00", attendees: ["kid"], repeat: { kind: "weekly", count: 8 } },
    { title: "Grandma's birthday", startDate: addDays(today, 11), allDay: true, attendees: ["parent", "adult", "kid"] },
    { title: "Car service", startDate: addDays(today, 1), startTime: "08:30", endTime: "09:30", attendees: ["parent"] },
    { title: "Dentist", startDate: today, startTime: "15:00", endTime: "15:45", attendees: ["kid", "adult"] },
  ];
}

/** Lab-only passwords: 24 random base64url characters, never anyone's real password. */
const newPassword = () => `lab-${randomBytes(18).toString("base64url")}`;

/** A tiny client for one signed-in browser: the cookies `/api/auth` sets, sent back on every call. */
function appClient(appUrl) {
  const cookies = new Map();
  const origin = new URL(appUrl).origin;
  async function call(method, path, body) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        origin,
        cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const equals = pair.indexOf("=");
      const name = pair.slice(0, equals);
      const value = pair.slice(equals + 1);
      if (value === "" || /max-age=0/i.test(header)) cookies.delete(name);
      else cookies.set(name, value);
    }
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${json?.error ?? text.slice(0, 200)}`);
    return json;
  }
  return {
    call,
    signIn: (name, password) => call("POST", "/api/auth", { mode: "login", email: name, password }),
  };
}

async function supabaseCall(env, path, { method = "GET", token, body, prefer } = {}) {
  const key = token ? env.SUPABASE_PUBLISHABLE_KEY : env.SUPABASE_SECRET_KEY;
  const response = await fetch(`${env.LAB_SUPABASE_DIRECT_URL}${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${token ?? key}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Runs SQL as the database owner in the lab's Postgres container; values go in as psql variables. */
function ownerSql(env, sql, variables) {
  const args = ["exec", "-i", env.LAB_DB_CONTAINER, "psql", "-X", "-q", "-At", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(variables)) args.push("-v", `${name}=${value ?? ""}`);
  return execFileSync("docker", args, { input: sql, encoding: "utf8" }).trim();
}

/**
 * A confirmed account through the Auth admin API, then its profile row as the live project's signup
 * trigger would write it (see the comment at the top for why not with the secret key).
 */
async function createAccount(env, { email, password, displayName, username = null, managedByFamily = null, mustChangePassword = false }) {
  const user = await supabaseCall(env, "/auth/v1/admin/users", { method: "POST", body: { email, password, email_confirm: true } });
  ownerSql(env, `insert into public.profiles (id, email, username, display_name, managed_by_family, must_change_password, currency)
    values (:'id', :'email', nullif(:'username', ''), :'display_name', nullif(:'family', '')::uuid, :'must_change'::boolean, 'RON');`, {
    id: user.id, email, username, display_name: displayName, family: managedByFamily, must_change: String(mustChangePassword),
  });
  return user.id;
}

async function accessToken(env, email, password) {
  const response = await fetch(`${env.LAB_SUPABASE_DIRECT_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`sign-in for the expense insert answered ${response.status}`);
  return (await response.json()).access_token;
}

async function insertExpenses(env, email, password, userId, rows) {
  const token = await accessToken(env, email, password);
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500).map((row) => ({ ...row, user_id: userId }));
    await supabaseCall(env, "/rest/v1/expenses", { method: "POST", token, body: batch, prefer: "return=minimal" });
  }
}

export async function seed(env, { now = new Date(), log = console.log } = {}) {
  const today = bucharestToday(now);
  const appUrl = env.SITE_URL;
  const passwords = { parent: newPassword(), adult: newPassword(), kidFirst: newPassword(), kid: newPassword(), solo: newPassword() };

  log(`seed: today is ${today} in ${TIME_ZONE}`);
  const ids = {
    parent: await createAccount(env, { ...PEOPLE.parent, password: passwords.parent }),
    adult: await createAccount(env, { ...PEOPLE.adult, password: passwords.adult }),
    solo: await createAccount(env, { ...PEOPLE.solo, password: passwords.solo }),
  };

  // The family, through the app: create it, invite Sam as a parent, add Robin as a kid.
  const parent = appClient(appUrl);
  await parent.signIn(PEOPLE.parent.email, passwords.parent);
  await parent.call("POST", "/api/family", { name: FAMILY_NAME });
  const invite = await parent.call("POST", "/api/family/invites", { role: "parent" });
  const adult = appClient(appUrl);
  await adult.signIn(PEOPLE.adult.email, passwords.adult);
  await adult.call("POST", "/api/family/join", { code: invite.code });
  // The kid: what POST /api/family/kids does (createKidAccount), step by step (see the top comment).
  const familyId = ownerSql(env, "select family_id from public.family_members where user_id = :'id';", { id: ids.parent });
  ids.kid = await createAccount(env, {
    email: PEOPLE.kid.email, password: passwords.kidFirst, displayName: PEOPLE.kid.displayName,
    username: PEOPLE.kid.username, managedByFamily: familyId, mustChangePassword: true,
  });
  const parentToken = await accessToken(env, PEOPLE.parent.email, passwords.parent);
  await supabaseCall(env, "/rest/v1/rpc/add_managed_kid", { method: "POST", token: parentToken, body: { p_user_id: ids.kid, p_permissions: KID_PERMISSIONS } });
  // A new kid must choose a password at first sign-in (mustChangePassword). Do it the way the kid would.
  const kid = appClient(appUrl);
  await kid.signIn(PEOPLE.kid.username, passwords.kidFirst);
  await kid.call("POST", "/api/account/password", { currentPassword: passwords.kidFirst, password: passwords.kid });
  await kid.signIn(PEOPLE.kid.username, passwords.kid);
  const solo = appClient(appUrl);
  await solo.signIn(PEOPLE.solo.email, passwords.solo);

  const { family } = await parent.call("GET", "/api/family");
  const memberOf = Object.fromEntries(
    ["parent", "adult", "kid"].map((key) => [key, family.members.find((member) => member.displayName === PEOPLE[key].displayName)]),
  );
  for (const [key, color] of [["parent", 1], ["adult", 4], ["kid", 6]]) {
    await parent.call("PATCH", `/api/family/members/${memberOf[key].memberId}/color`, { color });
  }
  log(`seed: family "${FAMILY_NAME}" with ${family.members.length} members, and one user without a family`);

  // Expenses, straight into the table as their owner.
  const plan = expensePlan(today);
  for (const [key, rows] of Object.entries(plan)) await insertExpenses(env, PEOPLE[key].email, passwords[key], ids[key], rows);
  log(`seed: expenses: ${plan.parent.length} for Alex, ${plan.adult.length} for Sam, ${plan.kid.length} for Robin`);

  // Saved expense tabs (Alex).
  await parent.call("POST", "/api/expense-tabs", { name: "Car", categoryKeys: ["car"], subtypeKeys: ["car_fuel", "car_maintenance", "car_repairs"] });
  await parent.call("POST", "/api/expense-tabs", { name: "Home and bills", categoryKeys: ["housing", "utilities"], subtypeKeys: [] });

  // Reminders, each as its owner; one of Alex's is already done.
  const clients = { parent, adult, kid, solo };
  const reminders = reminderPlan(today);
  let reminderCount = 0;
  for (const [key, list] of Object.entries(reminders)) {
    for (const { done, ...input } of list) {
      const { reminder } = await clients[key].call("POST", "/api/reminders", input);
      if (done) await clients[key].call("POST", `/api/reminders/${reminder.id}/complete`, {});
      reminderCount += 1;
    }
  }

  // The family's to-do board, cards added by whoever they're for.
  const todos = todoPlan(today);
  for (const todo of todos) {
    const author = clients[todo.assignee ?? "parent"];
    await author.call("POST", "/api/todos", {
      title: todo.title,
      assigneeMemberId: todo.assignee ? memberOf[todo.assignee].memberId : null,
      dueDate: todo.dueDate,
      status: todo.status,
    });
  }

  const events = calendarPlan(today);
  for (const { attendees, ...event } of events) {
    await parent.call("POST", "/api/calendar/events", { ...event, attendeeMemberIds: attendees.map((key) => memberOf[key].memberId) });
  }

  // A few investments and net-worth items (Alex).
  const orders = [
    ["xtb", "VWCE.DE", "EUR", "buy", "1100.00", "10", "110.00", 400],
    ["xtb", "VWCE.DE", "EUR", "buy", "1180.00", "10", "118.00", 200],
    ["xtb", "AAPL.US", "USD", "buy", "950.00", "5", "190.00", 300],
    ["banca_transilvania", "TLV.RO", "RON", "buy", "2400.00", "100", "24.00", 150],
    ["xtb", "AAPL.US", "USD", "sell", "420.00", "2", "210.00", 40],
  ];
  for (const [brokerId, instrument, currency, side, amount, quantity, unitPrice, daysAgo] of orders) {
    await parent.call("POST", "/api/investment-transactions", { brokerId, instrument, currency, side, amount, quantity, unitPrice, executedAt: `${addDays(today, -daysAgo)}T10:00:00.000Z` });
  }
  const items = [
    { name: "Savings account", kind: "asset", category: "cash", currency: "RON", value: "42000.00", valuedOn: monthStart(today) },
    { name: "Flat", kind: "asset", category: "property", currency: "EUR", purchaseAmount: "95000.00", value: "130000.00", valuedOn: monthStart(today, -1) },
    { name: "Mortgage", kind: "liability", category: "debt", currency: "EUR", value: "61000.00", valuedOn: monthStart(today) },
  ];
  for (const item of items) await parent.call("POST", "/api/net-worth/items", item);

  log(`seed: ${reminderCount} reminders, ${todos.length} to-dos, ${events.length} calendar events, ${orders.length} investment orders, ${items.length} net-worth items`);

  return {
    today,
    users: Object.fromEntries(Object.entries(PEOPLE).map(([key, person]) => [key, {
      signIn: person.username ?? person.email, password: passwords[key], userId: ids[key], displayName: person.displayName,
    }])),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [envFile, usersFile] = process.argv.slice(2);
  if (!envFile || !usersFile) {
    console.error("usage: node scripts/lab/seed.mjs <lab env file> <users file to write>");
    process.exit(2);
  }
  const env = parseEnvFile(readFileSync(envFile, "utf8"));
  const problems = guardProblems(env);
  if (!env.LAB_SUPABASE_DIRECT_URL) problems.push("LAB_SUPABASE_DIRECT_URL is not set");
  if (problems.length > 0) {
    for (const problem of problems) console.error(`lab seed: refusing: ${problem}`);
    process.exit(1);
  }
  try {
    const result = await seed(env);
    writeFileSync(usersFile, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(`seed: done; accounts and passwords are in ${usersFile}`);
  } catch (error) {
    console.error(`lab seed: ${error.message}`);
    process.exit(1);
  }
}
