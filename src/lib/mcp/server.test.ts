import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExpenseForUser: vi.fn(),
  updateExpenseForUser: vi.fn(),
  deleteExpenseForUser: vi.fn(),
  getMonthlyExpensesForUser: vi.fn(),
  getExpenseTabExpensesForUser: vi.fn(),
}));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
vi.mock("@/lib/data/expenses", () => ({
  createExpenseForUser: mocks.createExpenseForUser,
  updateExpenseForUser: mocks.updateExpenseForUser,
  deleteExpenseForUser: mocks.deleteExpenseForUser,
  getMonthlyExpensesForUser: mocks.getMonthlyExpensesForUser,
  getDashboardDataForUser: vi.fn(),
  getExpenseTabExpensesForUser: mocks.getExpenseTabExpensesForUser,
}));

import { createMcpServer } from "@/lib/mcp/server";
import { aManualItem, aTab, aTransaction, anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

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
  let repositories: FakeRepositories;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    repositories = resetFakeRepositories();
  });
  afterEach(() => vi.useRealTimers());

  describe("get_account", () => {
    it("returns the session user's email, saved currency, today and the categories", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-04T10:00:00Z"));
      repositories.account.currencies.set("owner", "RON");

      const { body } = await call("get_account");

      expect(body).toMatchObject({ email: "owner@example.com", currency: "RON", today: "2026-10-04" });
      expect(body.categories).toContainEqual(expect.objectContaining({ key: "car", subtypes: expect.arrayContaining([expect.objectContaining({ key: "car_fuel" })]) }));
    });

    it("returns the default currency when the user has not chosen one", async () => {
      const { body } = await call("get_account");

      expect(body.currency).toBe("EUR");
    });
  });

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
    repositories.netWorth.seed("owner", aManualItem({ id: ID, archivedAt: "2026-09-30T10:00:00Z" }));
    const result = await call("add_net_worth_valuation", { itemId: ID, value: "10", valuedOn: "2026-10-01" });
    expect(result.isError).toBe(true);
    expect(result.body.error).toBe("Archived items cannot receive new values.");
  });

  it("summarizes a month of expenses", async () => {
    mocks.getMonthlyExpensesForUser.mockResolvedValue([stored, { ...stored, amount: 4.5 }]);
    const result = await call("list_expenses", { month: "2026-10" });
    expect(result.structuredContent).toMatchObject({ month: "2026-10", total: 15, count: 2, average: 7.5 });
  });

  describe("investment tools", () => {
    const order = { brokerId: "xtb", instrument: "VWCE.DE", currency: "EUR", side: "buy", amount: "150", quantity: "1.5", unitPrice: "100", executedAt: "2026-01-01T10:00:00Z" };

    it("adds an investment order to the session user's account", async () => {
      const result = await call("add_investment_transaction", order);

      expect(result.isError).toBeFalsy();
      expect(repositories.investments.accounts).toEqual([expect.objectContaining({ userId: "owner", brokerId: "xtb" })]);
      expect(result.structuredContent).toEqual({ transaction: { ...repositories.investments.transactions[0], brokerId: "xtb" } });
    });

    it("reports another user's investment order as not found", async () => {
      repositories.investments.accounts.push({ id: "account-xtb", userId: "someone-else", brokerId: "xtb" });
      repositories.investments.transactions.push(aTransaction({ id: ID }));

      const result = await call("delete_investment_transaction", { id: ID });

      expect(result.isError).toBe(true);
      expect(result.body.error).toBe("Investment order not found.");
      expect(repositories.investments.transactions).toHaveLength(1);
    });
  });

  describe("get_expense_tab_expenses", () => {
    const tab = aTab({ id: ID });

    beforeEach(() => {
      repositories.expenseTabs.tabs.set("owner", [tab]);
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
