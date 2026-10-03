import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import {
  createExpenseTabForUser, deleteExpenseTabForUser, getExpenseTabForUser,
  getExpenseTabsForUser, updateExpenseTabForUser,
} from "@/lib/data/expense-tabs";

const userId = "10000000-0000-4000-8000-000000000031";
const id = "40000000-0000-4000-8000-000000000031";
const input = { name: "Fuel", categoryKeys: [], subtypeKeys: ["car_fuel" as const] };
const row = {
  id, name: "Fuel", category_keys: [], subtype_keys: ["car_fuel"],
  created_at: "2026-10-03T12:00:00Z", updated_at: "2026-10-03T12:00:00Z",
};
const tab = { id, ...input, createdAt: row.created_at, updatedAt: row.updated_at };

function mockQuery(data: unknown, error: unknown = null) {
  const result = { data, error };
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  const from = vi.fn().mockReturnValue(builder);
  mocks.createClient.mockResolvedValue({ from });
  return { builder, from };
}

describe("expense tab data ownership", () => {
  beforeEach(() => vi.resetAllMocks());

  it("loads and maps only the owner's configurations", async () => {
    const { builder, from } = mockQuery([row]);
    expect(await getExpenseTabsForUser(userId)).toEqual([tab]);
    expect(from).toHaveBeenCalledWith("expense_tabs");
    expect(builder.eq).toHaveBeenCalledWith("user_id", userId);
    expect(builder.order.mock.calls).toEqual([["created_at"], ["id"]]);
  });

  it("resolves configuration membership with both owner and stable ID predicates", async () => {
    const { builder } = mockQuery(row);
    expect(await getExpenseTabForUser(userId, id)).toEqual(tab);
    expect(builder.eq.mock.calls).toEqual([["user_id", userId], ["id", id]]);
  });

  it("derives the insert owner from the authenticated caller", async () => {
    const { builder } = mockQuery(row);
    expect(await createExpenseTabForUser(userId, input)).toEqual(tab);
    expect(builder.insert).toHaveBeenCalledWith({
      user_id: userId, name: "Fuel", category_keys: [], subtype_keys: ["car_fuel"],
    });
  });

  it("updates only tab selections and guards both owner and ID", async () => {
    const { builder } = mockQuery(row);
    expect(await updateExpenseTabForUser(userId, id, input)).toEqual(tab);
    expect(builder.update).toHaveBeenCalledWith({ name: "Fuel", category_keys: [], subtype_keys: ["car_fuel"] });
    expect(builder.eq.mock.calls).toEqual([["user_id", userId], ["id", id]]);
  });

  it("deletes only from the configurations table with owner and ID predicates", async () => {
    const { builder, from } = mockQuery({ id });
    expect(await deleteExpenseTabForUser(userId, id)).toBe(true);
    expect(from.mock.calls).toEqual([["expense_tabs"]]);
    expect(builder.eq.mock.calls).toEqual([["user_id", userId], ["id", id]]);
  });

  it("treats missing or inaccessible tab rows consistently", async () => {
    mockQuery(null);
    expect(await getExpenseTabForUser(userId, id)).toBeNull();
    expect(await updateExpenseTabForUser(userId, id, input)).toBeNull();
    expect(await deleteExpenseTabForUser(userId, id)).toBe(false);
  });

  it("does not turn database errors into successful empty results", async () => {
    mockQuery(null, { message: "Internal database error" });
    await expect(getExpenseTabsForUser(userId)).rejects.toThrow("Unable to load expense tabs.");
    await expect(getExpenseTabForUser(userId, id)).rejects.toThrow("Unable to load expense tab.");
    await expect(createExpenseTabForUser(userId, input)).rejects.toThrow("Unable to save expense tab.");
    await expect(updateExpenseTabForUser(userId, id, input)).rejects.toThrow("Unable to save expense tab.");
    await expect(deleteExpenseTabForUser(userId, id)).rejects.toThrow("Unable to delete expense tab.");
  });
});
