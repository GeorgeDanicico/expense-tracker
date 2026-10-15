import { beforeEach, describe, expect, it, vi } from "vitest";

import { aTab } from "@/test/builders";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseExpenseTabRepository as tabs } from "@/lib/supabase/repositories/expense-tabs";

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

const ownerFilter = ["eq", "user_id", userId];
const ownerAndId = [ownerFilter, ["eq", "id", id]];

describe("Supabase expense tab repository", () => {
  beforeEach(() => vi.resetAllMocks());

  it("lists only the owner's tabs, oldest first", async () => {
    const { queries } = useDatabase([foreignRow(), ownedRow()]);

    const listed = await tabs.list(userId);

    expect(listed).toEqual([tab]);
    expect(queries[0]).toMatchObject({ table: "expense_tabs", filters: [ownerFilter], orders: ["created_at", "id"] });
  });

  it("gets a single tab by both owner and id", async () => {
    const { queries } = useDatabase([ownedRow()]);

    const loaded = await tabs.get(userId, id);

    expect(loaded).toEqual(tab);
    expect(queries[0].filters).toEqual(ownerAndId);
  });

  it("takes the new tab's owner from the caller", async () => {
    const { tables, queries } = useDatabase([], { trigger: (row) => ({ created_at: tab.createdAt, updated_at: tab.updatedAt, ...row }) });

    const created = await tabs.create(userId, input);

    expect(created).toMatchObject(input);
    expect(queries[0]).toMatchObject({ operation: "insert", values: { user_id: userId } });
    expect(tables.expense_tabs).toEqual([expect.objectContaining({ user_id: userId, name: "Fuel", category_keys: [], subtype_keys: ["car_fuel"] })]);
  });

  it("updates only the tab's selections, guarded by owner and id", async () => {
    const { queries } = useDatabase([ownedRow()]);

    const updated = await tabs.update(userId, id, { ...input, name: "Car fuel" });

    expect(updated).toEqual({ ...tab, name: "Car fuel" });
    expect(queries[0]).toMatchObject({ values: { name: "Car fuel", category_keys: [], subtype_keys: ["car_fuel"] }, filters: ownerAndId });
  });

  it("deletes only the owner's addressed tab", async () => {
    const { queries, tables } = useDatabase([ownedRow(), foreignRow()]);

    const deleted = await tabs.delete(userId, id);

    expect(deleted).toBe(true);
    expect(queries[0].filters).toEqual(ownerAndId);
    expect(tables.expense_tabs).toEqual([foreignRow()]);
  });

  it.each([
    ["list", () => tabs.list(userId)],
    ["get", () => tabs.get(userId, id)],
    ["update", () => tabs.update(userId, id, input)],
    ["delete", () => tabs.delete(userId, id)],
  ] as const)("%s filters by owner explicitly", async (_name, call) => {
    const { queries } = useDatabase([ownedRow()]);

    await call();

    expect(queries).toHaveLength(1);
    expect(queries[0].filters).toContainEqual(ownerFilter);
  });

  it.each([
    ["get", () => tabs.get(userId, id), null],
    ["update", () => tabs.update(userId, id, input), null],
    ["delete", () => tabs.delete(userId, id), false],
  ] as const)("%s treats another user's tab as missing", async (_name, call, missing) => {
    useDatabase([foreignRow()]);

    expect(await call()).toBe(missing);
  });

  it.each([
    ["list", "Unable to load expense tabs.", () => tabs.list(userId)],
    ["get", "Unable to load expense tab.", () => tabs.get(userId, id)],
    ["create", "Unable to save expense tab.", () => tabs.create(userId, input)],
    ["update", "Unable to save expense tab.", () => tabs.update(userId, id, input)],
    ["delete", "Unable to delete expense tab.", () => tabs.delete(userId, id)],
  ] as const)("%s turns a database error into '%s'", async (_name, message, call) => {
    useDatabase([ownedRow()], { fail: () => true });

    await expect(call()).rejects.toThrow(new Error(message));
  });
});
