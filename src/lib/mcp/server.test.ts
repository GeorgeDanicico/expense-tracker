import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExpenseForUser: vi.fn(),
  updateExpenseForUser: vi.fn(),
  deleteExpenseForUser: vi.fn(),
  getMonthlyExpensesForUser: vi.fn(),
  getExpenseTabForUser: vi.fn(),
  getExpenseTabExpensesForUser: vi.fn(),
  addNetWorthValuationForUser: vi.fn(),
}));
vi.mock("@/lib/data/account", () => ({ getAccountCurrencyForUser: vi.fn() }));
vi.mock("@/lib/data/expenses", () => ({
  createExpenseForUser: mocks.createExpenseForUser,
  updateExpenseForUser: mocks.updateExpenseForUser,
  deleteExpenseForUser: mocks.deleteExpenseForUser,
  getMonthlyExpensesForUser: mocks.getMonthlyExpensesForUser,
  getDashboardDataForUser: vi.fn(),
  getExpenseTabExpensesForUser: mocks.getExpenseTabExpensesForUser,
}));
vi.mock("@/lib/data/expense-tabs", () => ({
  getExpenseTabsForUser: vi.fn(),
  getExpenseTabForUser: mocks.getExpenseTabForUser,
  createExpenseTabForUser: vi.fn(),
  updateExpenseTabForUser: vi.fn(),
  deleteExpenseTabForUser: vi.fn(),
}));
vi.mock("@/lib/data/investments", () => ({
  InvestmentMutationError: class extends Error {},
  getInvestmentsOverviewForUser: vi.fn(),
  getInvestmentTransactionsForUser: vi.fn(),
  createInvestmentTransactionForUser: vi.fn(),
  deleteInvestmentTransactionForUser: vi.fn(),
}));
vi.mock("@/lib/data/net-worth", () => ({
  NetWorthMutationError: class extends Error {
    constructor(message: string, readonly status: number, readonly fieldErrors?: Record<string, string[]>) { super(message); }
  },
  getNetWorthOverviewForUser: vi.fn(),
  createNetWorthItemForUser: vi.fn(),
  updateNetWorthItemForUser: vi.fn(),
  addNetWorthValuationForUser: mocks.addNetWorthValuationForUser,
  updateNetWorthValuationForUser: vi.fn(),
}));

import { NetWorthMutationError } from "@/lib/data/net-worth";
import { createMcpServer } from "@/lib/mcp/server";

const ID = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";
const stored = { id: ID, description: "Fuel", amount: 10.5, category: "car", subtype: "car_fuel", expenseDate: "2026-10-04", notes: null };

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ userId: "owner", email: "owner@example.com" });
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const client = await connect();
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  const text = content[0].text;
  return { ...result, text, body: text.startsWith("{") ? JSON.parse(text) : {} };
}

describe("MCP server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it("lists the 20 tools with their annotations", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools).toHaveLength(20);
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    for (const name of ["get_account", "list_expenses", "get_spending_summary", "list_expense_tabs", "get_expense_tab_expenses",
      "get_investments", "list_investment_transactions", "get_net_worth"]) {
      expect(byName[name].annotations).toMatchObject({ readOnlyHint: true });
    }
    const destructive = tools.filter((tool) => tool.annotations?.destructiveHint).map((tool) => tool.name).sort();
    expect(destructive).toEqual(["delete_expense", "delete_expense_tab", "delete_investment_transaction"]);
    for (const name of ["update_expense", "update_expense_tab", "update_net_worth_item", "add_net_worth_valuation", "update_net_worth_valuation"]) {
      expect(byName[name].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    }
    expect(byName.add_expense.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    for (const tool of tools) {
      expect(Object.keys((tool.inputSchema.properties ?? {}) as object)).not.toContain("userId");
    }
    expect(byName.add_expense.inputSchema.required).not.toContain("expenseDate");
  });

  it("adds expenses for the session user with today's date by default", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T22:30:00Z"));
    mocks.createExpenseForUser.mockResolvedValue(stored);
    const result = await call("add_expense", { description: "Fuel", amount: 10.5, category: "car", subtype: "car_fuel", user_id: "someone-else", userId: "someone-else" });
    expect(result.isError).toBeFalsy();
    expect(mocks.createExpenseForUser).toHaveBeenCalledWith("owner", expect.objectContaining({ amount: 10.5, expenseDate: "2026-10-04" }));
    expect(mocks.createExpenseForUser.mock.calls[0][1]).not.toHaveProperty("user_id");
    expect(mocks.createExpenseForUser.mock.calls[0][1]).not.toHaveProperty("userId");
    expect(result.structuredContent).toEqual({ expense: stored });
  });

  it("rejects a subtype outside the category with field errors and no data call", async () => {
    const result = await call("add_expense", { description: "Fuel", amount: 10, category: "groceries", subtype: "car_fuel" });
    expect(result.isError).toBe(true);
    expect(result.body.fieldErrors.subtype).toHaveLength(1);
    expect(mocks.createExpenseForUser).not.toHaveBeenCalled();
  });

  it("deletes expenses through the data layer", async () => {
    mocks.deleteExpenseForUser.mockResolvedValue(true);
    const result = await call("delete_expense", { id: ID });
    expect(mocks.deleteExpenseForUser).toHaveBeenCalledWith("owner", ID);
    expect(result.structuredContent).toEqual({ deleted: true, id: ID });
  });

  it("rejects ids that are not UUIDs", async () => {
    const result = await call("delete_expense", { id: "nope" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Input validation error");
    expect(mocks.deleteExpenseForUser).not.toHaveBeenCalled();
  });

  it("reports a missing expense on update", async () => {
    mocks.updateExpenseForUser.mockResolvedValue(null);
    const result = await call("update_expense", { id: ID, amount: 12 });
    expect(mocks.updateExpenseForUser).toHaveBeenCalledWith("owner", ID, { amount: 12 });
    expect(result.isError).toBe(true);
    expect(result.body.error).toBe("Expense not found.");
  });

  it("hides unexpected errors behind a generic message", async () => {
    mocks.getMonthlyExpensesForUser.mockRejectedValue(new Error("connection string leaked"));
    const result = await call("list_expenses", { month: "2026-09" });
    expect(result.isError).toBe(true);
    expect(result.body.error).toBe("The request could not be completed. Try again later.");
    expect(JSON.stringify(result)).not.toContain("leaked");
    expect(console.error).toHaveBeenCalled();
  });

  it("passes domain mutation messages through", async () => {
    mocks.addNetWorthValuationForUser.mockRejectedValue(new NetWorthMutationError("Archived items cannot receive new values.", 409));
    const result = await call("add_net_worth_valuation", { itemId: ID, value: "10", valuedOn: "2026-10-01" });
    expect(result.isError).toBe(true);
    expect(result.body.error).toBe("Archived items cannot receive new values.");
  });

  it("summarizes a month of expenses", async () => {
    mocks.getMonthlyExpensesForUser.mockResolvedValue([stored, { ...stored, amount: 4.5 }]);
    const result = await call("list_expenses", { month: "2026-10" });
    expect(result.structuredContent).toMatchObject({ month: "2026-10", total: 15, count: 2, average: 7.5 });
  });

  it("defaults and validates expense tab filters", async () => {
    const tab = { id: ID, name: "Car", categoryKeys: ["car"], subtypeKeys: [] };
    mocks.getExpenseTabForUser.mockResolvedValue(tab);
    mocks.getExpenseTabExpensesForUser.mockResolvedValue([]);
    await call("get_expense_tab_expenses", { tabId: ID });
    expect(mocks.getExpenseTabExpensesForUser).toHaveBeenCalledWith("owner", tab, { scope: "all", subtype: "all", category: null, search: "" });

    await call("get_expense_tab_expenses", { tabId: ID, filters: { scope: "year", year: 2025 } });
    expect(mocks.getExpenseTabExpensesForUser).toHaveBeenLastCalledWith("owner", tab, expect.objectContaining({ scope: "year", year: 2025 }));

    const invalid = await call("get_expense_tab_expenses", { tabId: ID, filters: { scope: "range", startDate: "2026-02-01", endDate: "2026-01-01" } });
    expect(invalid.isError).toBe(true);
    expect(mocks.getExpenseTabExpensesForUser).toHaveBeenCalledTimes(2);
  });
});
