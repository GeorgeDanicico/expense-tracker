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
  getInvestmentsOverviewForUser: vi.fn(),
  getInvestmentTransactionsForUser: vi.fn(),
  createInvestmentTransactionForUser: vi.fn(),
  deleteInvestmentTransactionForUser: vi.fn(),
}));
vi.mock("@/lib/data/net-worth", () => ({
  getNetWorthOverviewForUser: vi.fn(),
  createNetWorthItemForUser: vi.fn(),
  updateNetWorthItemForUser: vi.fn(),
  addNetWorthValuationForUser: mocks.addNetWorthValuationForUser,
  updateNetWorthValuationForUser: vi.fn(),
}));

import { DomainError } from "@/lib/errors";
import { createMcpServer } from "@/lib/mcp/server";
import { aTab, anExpense } from "@/test/builders";

const ID = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";
const stored = anExpense({ id: ID, description: "Fuel", amount: 10.5, category: "car", subtype: "car_fuel", expenseDate: "2026-10-04" });

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

  describe("tool list", () => {
    const listTools = async () => (await (await connect()).listTools()).tools;
    const annotationsOf = async (name: string) => (await listTools()).find((tool) => tool.name === name)?.annotations;

    it("lists 20 tools", async () => {
      expect(await listTools()).toHaveLength(20);
    });

    it.each(["get_account", "list_expenses", "get_spending_summary", "list_expense_tabs", "get_expense_tab_expenses",
      "get_investments", "list_investment_transactions", "get_net_worth"])("marks %s read-only", async (name) => {
      expect(await annotationsOf(name)).toMatchObject({ readOnlyHint: true });
    });

    it("marks only the three delete tools destructive", async () => {
      const destructive = (await listTools()).filter((tool) => tool.annotations?.destructiveHint).map((tool) => tool.name);

      expect(destructive.sort()).toEqual(["delete_expense", "delete_expense_tab", "delete_investment_transaction"]);
    });

    it.each(["update_expense", "update_expense_tab", "update_net_worth_item", "add_net_worth_valuation", "update_net_worth_valuation"])(
      "marks %s as an idempotent, non-destructive write",
      async (name) => {
        expect(await annotationsOf(name)).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
      },
    );

    it("marks add_expense as a non-idempotent, non-destructive write", async () => {
      expect(await annotationsOf("add_expense")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    });

    it("never accepts a userId input", async () => {
      const inputs = (await listTools()).flatMap((tool) => Object.keys((tool.inputSchema.properties ?? {}) as object));

      expect(inputs).not.toContain("userId");
    });

    it("lets add_expense omit the expense date", async () => {
      const addExpense = (await listTools()).find((tool) => tool.name === "add_expense");

      expect(addExpense?.inputSchema.required).not.toContain("expenseDate");
    });
  });

  describe("add_expense", () => {
    const fuel = { description: "Fuel", amount: 10.5, category: "car", subtype: "car_fuel" };

    beforeEach(() => mocks.createExpenseForUser.mockResolvedValue(stored));

    it("adds the expense for the session user, ignoring user ids in the arguments", async () => {
      await call("add_expense", { ...fuel, user_id: "someone-else", userId: "someone-else" });

      const [userId, input] = mocks.createExpenseForUser.mock.calls[0];
      expect(userId).toBe("owner");
      expect(input).not.toHaveProperty("user_id");
      expect(input).not.toHaveProperty("userId");
    });

    it("defaults the date to today in Bucharest", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-03T22:30:00Z"));

      await call("add_expense", fuel);

      expect(mocks.createExpenseForUser).toHaveBeenCalledWith("owner", expect.objectContaining({ expenseDate: "2026-10-04" }));
    });

    it("returns the stored expense", async () => {
      const result = await call("add_expense", fuel);

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ expense: stored });
    });
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
    mocks.addNetWorthValuationForUser.mockRejectedValue(new DomainError("Archived items cannot receive new values.", 409));
    const result = await call("add_net_worth_valuation", { itemId: ID, value: "10", valuedOn: "2026-10-01" });
    expect(result.isError).toBe(true);
    expect(result.body.error).toBe("Archived items cannot receive new values.");
  });

  it("summarizes a month of expenses", async () => {
    mocks.getMonthlyExpensesForUser.mockResolvedValue([stored, { ...stored, amount: 4.5 }]);
    const result = await call("list_expenses", { month: "2026-10" });
    expect(result.structuredContent).toMatchObject({ month: "2026-10", total: 15, count: 2, average: 7.5 });
  });

  describe("get_expense_tab_expenses", () => {
    const tab = aTab({ id: ID });

    beforeEach(() => {
      mocks.getExpenseTabForUser.mockResolvedValue(tab);
      mocks.getExpenseTabExpensesForUser.mockResolvedValue([]);
    });

    it("defaults to all of the tab's expenses", async () => {
      await call("get_expense_tab_expenses", { tabId: ID });

      expect(mocks.getExpenseTabExpensesForUser).toHaveBeenCalledWith("owner", tab, { scope: "all", subtype: "all", category: null, search: "" });
    });

    it("passes the given filters through", async () => {
      await call("get_expense_tab_expenses", { tabId: ID, filters: { scope: "year", year: 2025 } });

      expect(mocks.getExpenseTabExpensesForUser).toHaveBeenCalledWith("owner", tab, expect.objectContaining({ scope: "year", year: 2025 }));
    });

    it("rejects an inverted date range without reading expenses", async () => {
      const result = await call("get_expense_tab_expenses", { tabId: ID, filters: { scope: "range", startDate: "2026-02-01", endDate: "2026-01-01" } });

      expect(result.isError).toBe(true);
      expect(mocks.getExpenseTabExpensesForUser).not.toHaveBeenCalled();
    });
  });
});
