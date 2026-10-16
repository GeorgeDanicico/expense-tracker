import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBucharestMonth } from "@/lib/calendar";
import { buildExpenseWorkbook } from "@/lib/export/xlsx";
import { forgetLastActive } from "@/lib/family/last-active";
import { PARENT_PERMISSIONS, type CurrentMember, type FamilyData } from "@/lib/family/repository";
import { MEMBER_NOT_FOUND_MESSAGE } from "@/lib/family/viewed-user";
import type { Permissions } from "@/lib/permissions";
import { aFamily, aKid, aManualItem, aParent, aTab, aTransaction, aValuation, anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { signedInAs, testUser } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/export/xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export/xlsx")>();
  return { ...actual, buildExpenseWorkbook: vi.fn(actual.buildExpenseWorkbook) };
});
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
vi.mock("@/lib/investments/quotes/get-adapter", () => ({
  getInvestmentQuoteAdapter: () => ({ getQuotes: async () => new Map() }),
}));

import { GET as getDashboard } from "@/app/api/dashboard/route";
import { GET as getTabs, POST as createTab } from "@/app/api/expense-tabs/route";
import { DELETE as deleteTab, PATCH as updateTab } from "@/app/api/expense-tabs/[id]/route";
import { GET as getTabExpenses } from "@/app/api/expense-tabs/[id]/expenses/route";
import { GET as getExpenses, POST as createExpense } from "@/app/api/expenses/route";
import { DELETE as deleteExpense } from "@/app/api/expenses/[id]/route";
import { GET as exportExpenses } from "@/app/api/expenses/export/route";
import { GET as getInvestments } from "@/app/api/investments/route";
import { GET as getTransactions, POST as createTransaction } from "@/app/api/investment-transactions/route";
import { DELETE as deleteTransaction } from "@/app/api/investment-transactions/[id]/route";
import { GET as getNetWorth } from "@/app/api/net-worth/route";
import { POST as createItem } from "@/app/api/net-worth/items/route";
import { PATCH as updateItem } from "@/app/api/net-worth/items/[id]/route";
import { POST as addValuation } from "@/app/api/net-worth/items/[id]/valuations/route";
import { PATCH as updateValuation } from "@/app/api/net-worth/valuations/[id]/route";

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

// The Smiths: Mara (the signed-in parent), Dan (the other parent), and the kids Ana and Ion.
const MARA = { memberId: "60000000-0000-4000-8000-000000000001", userId: testUser.id };
const DAN = { memberId: "60000000-0000-4000-8000-000000000003", userId: "10000000-0000-4000-8000-000000000003" };
const ANA = { memberId: "60000000-0000-4000-8000-000000000002", userId: "10000000-0000-4000-8000-000000000002" };
const ION = { memberId: "60000000-0000-4000-8000-000000000004", userId: "10000000-0000-4000-8000-000000000004" };
const OUTSIDER_MEMBER_ID = "60000000-0000-4000-8000-000000000099";

const finance = (family_finance: Permissions["family_finance"]): Permissions =>
  ({ expenses: "edit", investments: "edit", net_worth: "edit", family_finance });

function smiths(): FamilyData {
  const base = aFamily();
  const entry = (member: typeof DAN, role: "parent" | "kid", displayName: string, currency = "EUR") => ({
    ...base.members[0], ...member, role, isCreator: false, displayName, currency,
    permissions: role === "parent" ? PARENT_PERMISSIONS : finance("off"),
  });
  return {
    family: base.family,
    members: [{ ...base.members[0], displayName: "Mara" }, entry(DAN, "parent", "Dan"), entry(ANA, "kid", "Ana", "RON"), entry(ION, "kid", "Ion", "USD")],
  };
}

/** Ids that differ per owner, so one owner's data can never be mistaken for another's. */
const idsOf = (userId: string) => {
  const n = userId.slice(-2);
  return {
    tab: `40000000-0000-4000-8000-0000000000${n}`,
    account: `20000000-0000-4000-8000-0000000000${n}`,
    transaction: `30000000-0000-4000-8000-0000000000${n}`,
    item: `50000000-0000-4000-8000-0000000000${n}`,
    valuation: `51000000-0000-4000-8000-0000000000${n}`,
    expense: `52000000-0000-4000-8000-0000000000${n}`,
  };
};

const THIS_MONTH = getBucharestMonth();

/** Gives `userId` one of everything, named after `name`. */
function seedFinance(userId: string, name: string) {
  const ids = idsOf(userId);
  repositories.expenses.expenses.set(userId, [
    anExpense({ id: ids.expense, description: `${name} groceries`, category: "groceries", expenseDate: "2024-02-01" }),
    anExpense({ id: `${ids.expense}-now`, description: `${name} lunch`, category: "groceries", expenseDate: `${THIS_MONTH}-01` }),
  ]);
  repositories.expenseTabs.tabs.set(userId, [aTab({ id: ids.tab, name: `${name} tab`, categoryKeys: ["groceries"] })]);
  repositories.investments.accounts.push({ id: ids.account, userId, brokerId: "xtb" });
  repositories.investments.transactions.push(aTransaction({ id: ids.transaction, investmentAccountId: ids.account }));
  repositories.netWorth.seed(userId, aManualItem({
    id: ids.item, name: `${name} savings`, valuations: [aValuation({ id: ids.valuation, itemId: ids.item })],
  }));
  repositories.account.currencies.set(userId, name === "Ana" ? "EUR" : "RON");
}

const withMember = (url: string, memberId: string) => `${url}${url.includes("?") ? "&" : "?"}member=${memberId}`;

/** Every finance read that takes `?member=`, with a URL for the owner's data and a marker only that owner's data has. */
const READS = [
  { route: "dashboard", handler: getDashboard, url: () => "/api/dashboard", marker: (name: string) => `${name} lunch` },
  { route: "expenses (month)", handler: getExpenses, url: () => "/api/expenses?month=2024-02", marker: (name: string) => `${name} groceries` },
  { route: "expenses (main ledger)", handler: getExpenses, url: () => "/api/expenses?month=2024-02&context=main", marker: (name: string) => `${name} groceries` },
  { route: "expense-tabs", handler: getTabs, url: () => "/api/expense-tabs", marker: (name: string) => `${name} tab` },
  {
    route: "expense-tabs/[id]/expenses",
    handler: getTabExpenses,
    url: (userId: string) => `/api/expense-tabs/${idsOf(userId).tab}/expenses`,
    params: (userId: string) => ({ id: idsOf(userId).tab }),
    marker: (name: string) => `${name} groceries`,
  },
  { route: "investments", handler: getInvestments, url: () => "/api/investments", marker: (_name: string, userId: string) => idsOf(userId).account },
  {
    route: "investment-transactions",
    handler: getTransactions,
    url: (userId: string) => `/api/investment-transactions?accountId=${idsOf(userId).account}&instrument=VWCE.DE&currency=EUR`,
    marker: (_name: string, userId: string) => idsOf(userId).transaction,
  },
  { route: "net-worth", handler: getNetWorth, url: () => "/api/net-worth", marker: (name: string) => `${name} savings` },
] as const;

type Read = (typeof READS)[number];

let repositories: FakeRepositories;

async function call(handler: Handler, { method = "GET", url, body, params = {} }: {
  method?: string; url: string; body?: unknown; params?: Record<string, string>;
}) {
  const request = new NextRequest(new URL(url, "http://localhost"), {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve(params as { id: string }) });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  return { status: response.status, headers: response.headers, body: isJson ? await response.json() : null };
}

function read(entry: Read, ownerId: string, memberId?: string) {
  const url = memberId ? withMember(entry.url(ownerId), memberId) : entry.url(ownerId);
  const params = "params" in entry ? entry.params(ownerId) : {};
  return call(entry.handler as Handler, { url, params });
}

/** Signs in as `member` (a membership plus a user id). */
function signInAs(userId: string, membership: CurrentMember | null) {
  signedInAs({ id: userId, email: `${userId}@example.test` });
  repositories.family.membership = membership;
}

/** What `userId` sees of their own data, without `viewing`, read as a user without a family. */
async function ownView(entry: Read, userId: string) {
  const previous = repositories.family.membership;
  signInAs(userId, null);
  const { body } = await read(entry, userId);
  signInAs(testUser.id, previous);
  delete body.viewing;
  return body;
}

function withoutViewing(body: Record<string, unknown>) {
  const rest = { ...body };
  delete rest.viewing;
  return rest;
}

beforeEach(() => {
  vi.clearAllMocks();
  repositories = resetFakeRepositories();
  forgetLastActive();
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.family.family = smiths();
  signInAs(MARA.userId, aParent());
  seedFinance(MARA.userId, "Mara");
  seedFinance(DAN.userId, "Dan");
  seedFinance(ANA.userId, "Ana");
  seedFinance(ION.userId, "Ion");
});

afterEach(() => vi.unstubAllEnvs());

describe("finance reads with ?member=", () => {
  it.each(READS)("lets a parent read a kid's $route, read-only", async (entry) => {
    const response = await read(entry, ANA.userId, ANA.memberId);

    expect(response.status).toBe(200);
    expect(response.body.viewing).toEqual({ memberId: ANA.memberId, displayName: "Ana", currency: "RON", readOnly: true });
    expect(withoutViewing(response.body)).toEqual(await ownView(entry, ANA.userId));
    expect(JSON.stringify(response.body)).toContain(entry.marker("Ana", ANA.userId));
    expect(JSON.stringify(response.body)).not.toContain(entry.marker("Mara", MARA.userId));
  });

  it.each(READS)("lets a parent read the other parent's $route", async (entry) => {
    const response = await read(entry, DAN.userId, DAN.memberId);

    expect(response.status).toBe(200);
    expect(response.body.viewing).toEqual({ memberId: DAN.memberId, displayName: "Dan", currency: "EUR", readOnly: true });
    expect(withoutViewing(response.body)).toEqual(await ownView(entry, DAN.userId));
  });

  it.each(READS)("lets a kid with family finance read a sibling's $route", async (entry) => {
    signInAs(ANA.userId, aKid({ memberId: ANA.memberId, permissions: finance("view") }));

    const response = await read(entry, ION.userId, ION.memberId);

    expect(response.status).toBe(200);
    expect(response.body.viewing).toEqual({ memberId: ION.memberId, displayName: "Ion", currency: "USD", readOnly: true });
    expect(JSON.stringify(response.body)).toContain(entry.marker("Ion", ION.userId));
    expect(JSON.stringify(response.body)).not.toContain(entry.marker("Ana", ANA.userId));
  });

  it.each(READS)("answers 404 to a kid without family finance on $route", async (entry) => {
    signInAs(ANA.userId, aKid({ memberId: ANA.memberId, permissions: finance("off") }));

    const response = await read(entry, ION.userId, ION.memberId);

    expect(response).toMatchObject({ status: 404, body: { error: MEMBER_NOT_FOUND_MESSAGE } });
    expect(Object.keys(response.body)).toEqual(["error"]);
    expect(repositories.family.calls).not.toContain("getFamily");
  });

  it.each(READS)("answers the same 404 for an unknown member on $route", async (entry) => {
    const response = await read(entry, ANA.userId, "60000000-0000-4000-8000-0000000000aa");

    expect(response).toMatchObject({ status: 404, body: { error: MEMBER_NOT_FOUND_MESSAGE } });
  });

  it.each(READS)("answers the same 404 for another family's member on $route", async (entry) => {
    const response = await read(entry, ANA.userId, OUTSIDER_MEMBER_ID);

    expect(response).toMatchObject({ status: 404, body: { error: MEMBER_NOT_FOUND_MESSAGE } });
  });

  it.each(READS)("answers the same 404 for a malformed member id on $route, before loading the family", async (entry) => {
    const response = await read(entry, ANA.userId, "not-a-member");

    expect(response).toMatchObject({ status: 404, body: { error: MEMBER_NOT_FOUND_MESSAGE } });
    expect(repositories.family.calls).toEqual(["touchLastActive", "getMembership"]);
  });

  it.each(READS)("answers 404 to any member id on $route while the family flag is off, without a family query", async (entry) => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await read(entry, ANA.userId, ANA.memberId);

    expect(response).toMatchObject({ status: 404, body: { error: MEMBER_NOT_FOUND_MESSAGE } });
    expect(repositories.family.calls).toEqual([]);
  });

  it.each(READS)("returns the caller's own $route for their own member id", async (entry) => {
    const response = await read(entry, MARA.userId, MARA.memberId);

    expect(response.status).toBe(200);
    expect(response.body.viewing).toEqual({ memberId: MARA.memberId, displayName: null, currency: null, readOnly: false });
    expect(withoutViewing(response.body)).toEqual(await ownView(entry, MARA.userId));
  });

  it.each(READS)("returns the caller's own $route without the parameter, with no extra family query", async (entry) => {
    const response = await read(entry, MARA.userId);

    expect(repositories.family.calls).toEqual(["touchLastActive", "getMembership"]);
    expect(response.status).toBe(200);
    expect(response.body.viewing).toEqual({ memberId: MARA.memberId, displayName: null, currency: null, readOnly: false });
    expect(withoutViewing(response.body)).toEqual(await ownView(entry, MARA.userId));
  });

  it.each(READS)("leaves $route unchanged apart from viewing while the family flag is off", async (entry) => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const response = await read(entry, MARA.userId);

    expect(response.status).toBe(200);
    expect(response.body.viewing).toEqual({ memberId: null, displayName: null, currency: null, readOnly: false });
    expect(withoutViewing(response.body)).toEqual(await ownView(entry, MARA.userId));
    expect(repositories.family.calls).toEqual([]);
  });

  it.each(READS)("still refuses $route with 403 to a kid without the module, before resolving the member", async (entry) => {
    const moduleKey = entry.route.startsWith("invest") ? "investments" : entry.route === "net-worth" ? "net_worth" : "expenses";
    signInAs(ANA.userId, aKid({ memberId: ANA.memberId, permissions: { ...finance("view"), [moduleKey]: "off" } }));

    const response = await read(entry, ION.userId, ION.memberId);

    expect(response).toMatchObject({ status: 403, body: { error: "You don't have access to this." } });
    expect(repositories.family.calls).toEqual(["touchLastActive", "getMembership"]);
  });
});

describe("GET /api/expenses/export with ?member=", () => {
  const exportMonth = (memberId?: string) =>
    call(exportExpenses as Handler, { url: memberId ? withMember("/api/expenses/export?month=2024-02", memberId) : "/api/expenses/export?month=2024-02" });

  it("exports the viewed member's month for a parent", async () => {
    const listMonth = vi.spyOn(repositories.expenses, "listMonth");

    const response = await exportMonth(ANA.memberId);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-expense-month")).toBe("2024-02");
    expect(listMonth).toHaveBeenCalledWith(ANA.userId, "2024-02");
  });

  it("labels the viewed member's export with their currency from the family, not the viewer's", async () => {
    const getCurrency = vi.spyOn(repositories.account, "getCurrency");
    repositories.account.currencies.set(MARA.userId, "GBP");

    await exportMonth(ANA.memberId);

    expect(buildExpenseWorkbook).toHaveBeenLastCalledWith(expect.anything(), "RON");
    expect(getCurrency).not.toHaveBeenCalled();
  });

  it("exports the caller's own month without the parameter", async () => {
    const listMonth = vi.spyOn(repositories.expenses, "listMonth");
    repositories.account.currencies.set(MARA.userId, "GBP");

    expect((await exportMonth()).status).toBe(200);
    expect(buildExpenseWorkbook).toHaveBeenLastCalledWith(expect.anything(), "GBP");
    expect(listMonth).toHaveBeenCalledWith(MARA.userId, "2024-02");
  });

  it("answers 404 to a kid without family finance, without exporting anything", async () => {
    signInAs(ANA.userId, aKid({ memberId: ANA.memberId, permissions: finance("off") }));
    const listMonth = vi.spyOn(repositories.expenses, "listMonth");

    const response = await exportMonth(ION.memberId);

    expect(response).toMatchObject({ status: 404, body: { error: MEMBER_NOT_FOUND_MESSAGE } });
    expect(listMonth).not.toHaveBeenCalled();
  });

  it("answers 404 to an unknown member", async () => {
    expect(await exportMonth(OUTSIDER_MEMBER_ID)).toMatchObject({ status: 404, body: { error: MEMBER_NOT_FOUND_MESSAGE } });
  });
});

describe("finance writes ignore ?member=", () => {
  // Mara is a parent, so she could view Ana; every write must still act on Mara alone.
  const ana = idsOf(ANA.userId);
  const asAna = (url: string) => withMember(url, ANA.memberId);

  afterEach(() => {
    expect(repositories.family.calls).not.toContain("getFamily");
  });

  it("POST /api/expenses creates the expense for the caller", async () => {
    const body = { selectedMonth: "2026-09", expenseDate: "2026-09-01", description: "Fuel", amount: "10.50", category: "car", subtype: "car_fuel" };

    const response = await call(createExpense as Handler, { method: "POST", url: asAna("/api/expenses"), body });

    expect(response.status).toBe(201);
    expect(repositories.expenses.expenses.get(MARA.userId)).toContainEqual(response.body.expense);
    expect(repositories.expenses.expenses.get(ANA.userId)).not.toContainEqual(response.body.expense);
  });

  it("DELETE /api/expenses/[id] never deletes the viewed member's expense", async () => {
    const response = await call(deleteExpense as Handler, {
      method: "DELETE", url: asAna(`/api/expenses/${ana.expense}`), params: { id: ana.expense },
    });

    expect(response.status).toBe(200);
    expect(repositories.expenses.expenses.get(ANA.userId)?.map((expense) => expense.id)).toContain(ana.expense);
  });

  it("POST /api/expense-tabs creates the tab for the caller", async () => {
    const response = await call(createTab as Handler, {
      method: "POST", url: asAna("/api/expense-tabs"), body: { name: "New", categoryKeys: ["car"], subtypeKeys: [] },
    });

    expect(response.status).toBe(201);
    expect(repositories.expenseTabs.tabs.get(MARA.userId)).toContainEqual(response.body.tab);
    expect(repositories.expenseTabs.tabs.get(ANA.userId)).toHaveLength(1);
  });

  it("PATCH /api/expense-tabs/[id] can't change the viewed member's tab", async () => {
    const response = await call(updateTab as Handler, {
      method: "PATCH", url: asAna(`/api/expense-tabs/${ana.tab}`), params: { id: ana.tab },
      body: { name: "Hijacked", categoryKeys: ["car"], subtypeKeys: [] },
    });

    expect(response).toMatchObject({ status: 404, body: { error: "Expense tab not found." } });
    expect(repositories.expenseTabs.tabs.get(ANA.userId)?.[0].name).toBe("Ana tab");
  });

  it("DELETE /api/expense-tabs/[id] can't delete the viewed member's tab", async () => {
    const response = await call(deleteTab as Handler, {
      method: "DELETE", url: asAna(`/api/expense-tabs/${ana.tab}`), params: { id: ana.tab },
    });

    expect(response).toMatchObject({ status: 404, body: { error: "Expense tab not found." } });
    expect(repositories.expenseTabs.tabs.get(ANA.userId)).toHaveLength(1);
  });

  it("POST /api/investment-transactions records the order for the caller", async () => {
    const order = { brokerId: "banca_transilvania", instrument: "VWCE.DE", currency: "EUR", side: "buy", amount: "150", quantity: "1.5", unitPrice: "100", executedAt: "2026-01-01T10:00:00Z" };

    const response = await call(createTransaction as Handler, { method: "POST", url: asAna("/api/investment-transactions"), body: order });

    expect(response.status).toBe(201);
    const created = repositories.investments.accounts.find((account) => account.brokerId === "banca_transilvania");
    expect(created?.userId).toBe(MARA.userId);
  });

  it("DELETE /api/investment-transactions/[id] can't delete the viewed member's order", async () => {
    const response = await call(deleteTransaction as Handler, {
      method: "DELETE", url: asAna(`/api/investment-transactions/${ana.transaction}`), params: { id: ana.transaction },
    });

    expect(response).toMatchObject({ status: 404, body: { error: "Investment order not found." } });
    expect(repositories.investments.transactions.map((transaction) => transaction.id)).toContain(ana.transaction);
  });

  it("POST /api/net-worth/items creates the item for the caller", async () => {
    const body = { name: "Cash", kind: "asset", category: "cash", currency: "EUR", value: "10", valuedOn: "2026-09-19" };

    const response = await call(createItem as Handler, { method: "POST", url: asAna("/api/net-worth/items"), body });

    expect(response.status).toBe(201);
    expect(repositories.netWorth.items.get(response.body.itemId)?.userId).toBe(MARA.userId);
  });

  it("PATCH /api/net-worth/items/[id] can't change the viewed member's item", async () => {
    const response = await call(updateItem as Handler, {
      method: "PATCH", url: asAna(`/api/net-worth/items/${ana.item}`), params: { id: ana.item }, body: { name: "Hijacked" },
    });

    expect(response).toMatchObject({ status: 404, body: { error: "Net-worth item not found." } });
    expect(repositories.netWorth.items.get(ana.item)?.name).toBe("Ana savings");
  });

  it("POST /api/net-worth/items/[id]/valuations can't value the viewed member's item", async () => {
    const response = await call(addValuation as Handler, {
      method: "POST", url: asAna(`/api/net-worth/items/${ana.item}/valuations`), params: { id: ana.item },
      body: { value: "999", valuedOn: "2026-09-20" },
    });

    expect(response).toMatchObject({ status: 404, body: { error: "Net-worth item not found." } });
    expect([...repositories.netWorth.valuations.values()].filter((valuation) => valuation.itemId === ana.item)).toHaveLength(1);
  });

  it("PATCH /api/net-worth/valuations/[id] can't correct the viewed member's valuation", async () => {
    const response = await call(updateValuation as Handler, {
      method: "PATCH", url: asAna(`/api/net-worth/valuations/${ana.valuation}`), params: { id: ana.valuation },
      body: { value: "999", valuedOn: "2026-09-19" },
    });

    expect(response).toMatchObject({ status: 404, body: { error: "Valuation not found." } });
    expect(repositories.netWorth.valuations.get(ana.valuation)?.value).toBe("1000");
  });
});
