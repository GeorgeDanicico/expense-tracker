import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import type { ExpenseRepository } from "@/lib/expenses/repository";
import { createMcpServer } from "@/lib/mcp/server";
import { aKid, aManualItem, aParent, aTab, aTransaction, anExpense } from "@/test/builders";
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

  let expenses: { [Method in "create" | "update" | "delete" | "listMonth" | "listForTab"]: MockInstance<ExpenseRepository[Method]> };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    repositories = resetFakeRepositories();
    expenses = {
      create: vi.spyOn(repositories.expenses, "create"),
      update: vi.spyOn(repositories.expenses, "update"),
      delete: vi.spyOn(repositories.expenses, "delete"),
      listMonth: vi.spyOn(repositories.expenses, "listMonth"),
      listForTab: vi.spyOn(repositories.expenses, "listForTab"),
    };
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

    beforeEach(() => expenses.create.mockResolvedValue(stored));

    it("adds the expense for the session user, ignoring user ids in the arguments", async () => {
      await call("add_expense", { ...fuel, user_id: "someone-else", userId: "someone-else" });

      const [userId, input] = expenses.create.mock.calls[0];
      expect(userId).toBe("owner");
      expect(input).not.toHaveProperty("user_id");
      expect(input).not.toHaveProperty("userId");
    });

    it("defaults the date to today in Bucharest", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-03T22:30:00Z"));

      await call("add_expense", fuel);

      expect(expenses.create).toHaveBeenCalledWith("owner", expect.objectContaining({ expenseDate: "2026-10-04" }));
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
    expect(expenses.create).not.toHaveBeenCalled();
  });

  it("deletes expenses through the data layer", async () => {
    repositories.expenses.expenses.set("owner", [stored]);
    const result = await call("delete_expense", { id: ID });
    expect(expenses.delete).toHaveBeenCalledWith("owner", ID);
    expect(result.structuredContent).toEqual({ deleted: true, id: ID });
    expect(repositories.expenses.expenses.get("owner")).toEqual([]);
  });

  it("rejects ids that are not UUIDs", async () => {
    const result = await call("delete_expense", { id: "nope" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Input validation error");
    expect(expenses.delete).not.toHaveBeenCalled();
  });

  it("reports a missing expense on update", async () => {
    const result = await call("update_expense", { id: ID, amount: 12 });
    expect(expenses.update).toHaveBeenCalledWith("owner", ID, { amount: 12 });
    expect(result.isError).toBe(true);
    expect(result.body.error).toBe("Expense not found.");
  });

  it("hides unexpected errors behind a generic message", async () => {
    expenses.listMonth.mockRejectedValue(new Error("connection string leaked"));
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
    repositories.expenses.expenses.set("owner", [stored, { ...stored, id: "second", amount: 4.5 }]);
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
    });

    it("defaults to all of the tab's expenses", async () => {
      await call("get_expense_tab_expenses", { tabId: ID });

      expect(expenses.listForTab).toHaveBeenCalledWith("owner", tab, { scope: "all", subtype: "all", category: null, search: "" });
    });

    it("passes the given filters through", async () => {
      await call("get_expense_tab_expenses", { tabId: ID, filters: { scope: "year", year: 2025 } });

      expect(expenses.listForTab).toHaveBeenCalledWith("owner", tab, expect.objectContaining({ scope: "year", year: 2025 }));
    });

    it("rejects an inverted date range without reading expenses", async () => {
      const result = await call("get_expense_tab_expenses", { tabId: ID, filters: { scope: "range", startDate: "2026-02-01", endDate: "2026-01-01" } });

      expect(result.isError).toBe(true);
      expect(expenses.listForTab).not.toHaveBeenCalled();
    });
  });
});

describe("MCP family permissions", () => {
  const FORBIDDEN = "You don't have access to this.";
  const fuel = { description: "Fuel", amount: 10.5, category: "car", subtype: "car_fuel" };
  const order = { brokerId: "xtb", instrument: "VWCE.DE", currency: "EUR", side: "buy", amount: "150", quantity: "1.5", unitPrice: "100", executedAt: "2026-01-01T10:00:00Z" };
  const kidWithoutInvestments = () => aKid({ permissions: { expenses: "edit", investments: "off", net_worth: "off", family_finance: "off", mcp: "off" } });
  const kidWithNothing = () => aKid({ permissions: { expenses: "off", investments: "off", net_worth: "off", family_finance: "off", mcp: "off" } });

  const investmentMethods = [
    "listAccountsWithTransactions", "getAssetHistory", "listAssetTransactions", "getOrCreateAccount",
    "findTransaction", "createTransaction", "deleteTransaction",
  ] as const;

  let repositories: FakeRepositories;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    repositories = resetFakeRepositories();
    vi.stubEnv("FAMILY_ENABLED", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["get_investments", {}],
    ["list_investment_transactions", { accountId: ID, instrument: "VWCE.DE", currency: "EUR" }],
    ["add_investment_transaction", order],
    ["delete_investment_transaction", { id: ID }],
  ])("refuses %s for a kid with investments off, without touching the data", async (name, args) => {
    repositories.family.membership = kidWithoutInvestments();
    const spies = investmentMethods.map((method) => vi.spyOn(repositories.investments, method));

    const result = await call(name, args);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: FORBIDDEN });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["list_expenses", { month: "2026-10" }],
    ["get_spending_summary", {}],
    ["add_expense", fuel],
    ["list_expense_tabs", {}],
    ["create_expense_tab", { name: "Car", categoryKeys: ["car"], subtypeKeys: [] }],
  ])("allows %s for a kid with expenses on", async (name, args) => {
    repositories.family.membership = kidWithoutInvestments();

    const result = await call(name, args);

    expect(result.isError).toBeFalsy();
  });

  it("refuses the net worth tools for a kid with net worth off", async () => {
    repositories.family.membership = kidWithoutInvestments();

    const result = await call("get_net_worth");

    expect(result.structuredContent).toEqual({ error: FORBIDDEN });
  });

  it("refuses the expense tools for a kid with expenses off", async () => {
    repositories.family.membership = kidWithNothing();
    const create = vi.spyOn(repositories.expenses, "create");

    const result = await call("add_expense", fuel);

    expect(result.structuredContent).toEqual({ error: FORBIDDEN });
    expect(create).not.toHaveBeenCalled();
  });

  it("lets a kid with every module off read the account, without reading the membership", async () => {
    repositories.family.membership = kidWithNothing();

    const result = await call("get_account");

    expect(result.isError).toBeFalsy();
    expect(repositories.family.calls).toEqual([]);
  });

  it("lets a parent use the investments tools", async () => {
    repositories.family.membership = aParent();

    const result = await call("add_investment_transaction", order);

    expect(result.isError).toBeFalsy();
    expect(repositories.investments.transactions).toHaveLength(1);
  });

  it("lets a user without a family use the investments tools", async () => {
    const result = await call("add_investment_transaction", order);

    expect(result.isError).toBeFalsy();
    expect(repositories.investments.transactions).toHaveLength(1);
    expect(repositories.family.calls).toEqual(["getMembership"]);
  });

  it("runs the tools without reading the membership while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    repositories.family.membership = kidWithNothing();

    const result = await call("add_investment_transaction", order);

    expect(result.isError).toBeFalsy();
    expect(repositories.investments.transactions).toHaveLength(1);
    expect(repositories.family.calls).toEqual([]);
  });

  it("hides a failure to read the membership behind the generic message", async () => {
    vi.spyOn(repositories.family, "getMembership").mockRejectedValue(new Error("connection string leaked"));

    const result = await call("list_expenses", { month: "2026-10" });

    expect(result.isError).toBe(true);
    expect(result.body.error).toBe("The request could not be completed. Try again later.");
    expect(JSON.stringify(result)).not.toContain("leaked");
  });
});
