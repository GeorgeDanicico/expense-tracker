import { beforeEach, describe, expect, it, vi } from "vitest";

import { aTab } from "@/test/builders";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import {
  createExpenseTabForUser, deleteExpenseTabForUser, getExpenseTabForUser,
  getExpenseTabsForUser, updateExpenseTabForUser,
} from "@/lib/data/expense-tabs";

const userId = "10000000-0000-4000-8000-000000000031";
const id = "40000000-0000-4000-8000-000000000031";
const input = { name: "Fuel", categoryKeys: [], subtypeKeys: ["car_fuel" as const] };
const tab = aTab({ id, ...input, createdAt: "2026-10-03T12:00:00Z", updatedAt: "2026-10-03T12:00:00Z" });
const ownedRow = () => ({
  id, user_id: userId, name: "Fuel", category_keys: [], subtype_keys: ["car_fuel"],
  created_at: tab.createdAt, updated_at: tab.updatedAt,
});
const foreignRow = () => ({ ...ownedRow(), id: "40000000-0000-4000-8000-000000000032", user_id: "someone-else" });

function useDatabase(rows: Record<string, unknown>[], options?: FakeSupabaseOptions) {
  const database = fakeSupabase({ expense_tabs: rows }, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

const ownerAndId = [["eq", "user_id", userId], ["eq", "id", id]];

describe("expense tab data access", () => {
  beforeEach(() => vi.resetAllMocks());

  it("loads only the owner's tabs, oldest first", async () => {
    const { queries } = useDatabase([foreignRow(), ownedRow()]);

    const tabs = await getExpenseTabsForUser(userId);

    expect(tabs).toEqual([tab]);
    expect(queries[0]).toMatchObject({ table: "expense_tabs", filters: [["eq", "user_id", userId]], orders: ["created_at", "id"] });
  });

  it("loads a single tab by both owner and id", async () => {
    const { queries } = useDatabase([ownedRow()]);

    const loaded = await getExpenseTabForUser(userId, id);

    expect(loaded).toEqual(tab);
    expect(queries[0].filters).toEqual(ownerAndId);
  });

  it("takes the new tab's owner from the caller", async () => {
    const { tables } = useDatabase([], { trigger: (row) => ({ created_at: tab.createdAt, updated_at: tab.updatedAt, ...row }) });

    const created = await createExpenseTabForUser(userId, input);

    expect(created).toMatchObject(input);
    expect(tables.expense_tabs).toEqual([expect.objectContaining({ user_id: userId, name: "Fuel", category_keys: [], subtype_keys: ["car_fuel"] })]);
  });

  it("updates only the tab's selections, guarded by owner and id", async () => {
    const { queries } = useDatabase([ownedRow()]);

    const updated = await updateExpenseTabForUser(userId, id, { ...input, name: "Car fuel" });

    expect(updated).toEqual({ ...tab, name: "Car fuel" });
    expect(queries[0]).toMatchObject({ values: { name: "Car fuel", category_keys: [], subtype_keys: ["car_fuel"] }, filters: ownerAndId });
  });

  it("deletes only the owner's addressed tab", async () => {
    const { queries, tables } = useDatabase([ownedRow(), foreignRow()]);

    const deleted = await deleteExpenseTabForUser(userId, id);

    expect(deleted).toBe(true);
    expect(queries[0].filters).toEqual(ownerAndId);
    expect(tables.expense_tabs).toEqual([foreignRow()]);
  });

  it.each([
    ["getExpenseTabForUser", () => getExpenseTabForUser(userId, id), null],
    ["updateExpenseTabForUser", () => updateExpenseTabForUser(userId, id, input), null],
    ["deleteExpenseTabForUser", () => deleteExpenseTabForUser(userId, id), false],
  ] as const)("%s treats another user's tab as missing", async (_name, call, missing) => {
    useDatabase([foreignRow()]);

    expect(await call()).toBe(missing);
  });

  it.each([
    ["getExpenseTabsForUser", "Unable to load expense tabs.", () => getExpenseTabsForUser(userId)],
    ["getExpenseTabForUser", "Unable to load expense tab.", () => getExpenseTabForUser(userId, id)],
    ["createExpenseTabForUser", "Unable to save expense tab.", () => createExpenseTabForUser(userId, input)],
    ["updateExpenseTabForUser", "Unable to save expense tab.", () => updateExpenseTabForUser(userId, id, input)],
    ["deleteExpenseTabForUser", "Unable to delete expense tab.", () => deleteExpenseTabForUser(userId, id)],
  ] as const)("%s turns a database error into '%s'", async (_name, message, call) => {
    useDatabase([ownedRow()], { fail: () => true });

    await expect(call()).rejects.toThrow(message);
  });
});
