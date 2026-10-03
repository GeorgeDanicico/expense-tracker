import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import { DEFAULT_EXPENSE_TAB_FILTERS } from "@/lib/expenses/tab-filters";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);
import { getExpenseTabExpensesForUser } from "./expenses";

type Row = { id: string; description: string; notes: string | null; amount: string; category: ExpenseCategory; subtype: ExpenseSubtype | null; expense_date: string; created_at: string; user_id: string };
const tab: ExpenseTab = { id: "tab", name: "Car", categoryKeys: ["car"], subtypeKeys: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" };
const row = (id: string, subtype: ExpenseSubtype | null, date: string, amount = "10.25", category: ExpenseCategory = "car", owner = "owner"): Row => ({ id, subtype, category, expense_date: date, amount, user_id: owner, description: `Expense ${id}`, notes: null, created_at: "2026-01-01T00:00:00Z" });
const fixtures = [
  row("a", null, "2024-12-31", "1.10"), row("b", "car_fuel", "2025-01-01", "2.20"),
  { ...row("c", "car_maintenance", "2025-12-31", "3.30"), notes: "Garage service" },
  row("d", "car_repairs", "2026-01-01", "4.40"), row("e", null, "2026-01-01", "5.50"),
  row("outside", null, "2025-01-01", "999", "transport"),
  row("other-owner", "car_fuel", "2025-01-01", "999", "car", "other"),
];

type RequestLog = { owner: string; membership: string; orders: string[]; range: number[] };
let requests: RequestLog[];
// The fixture adapter executes the same AND/OR/date/null/order semantics as the Data API.
function clientFor(rows: Row[], cap = 500, failPage = -1) {
  return { from: vi.fn(() => {
    let selected = rows.slice();
    let membership = "";
    let owner = "";
    const orders: string[] = [];
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((key: keyof Row, value: string) => { if (key === "user_id") owner = value; selected = selected.filter((item) => item[key] === value); return query; }),
      is: vi.fn((key: keyof Row, value: null) => { selected = selected.filter((item) => item[key] === value); return query; }),
      gte: vi.fn((key: "expense_date", value: string) => { selected = selected.filter((item) => item[key] >= value); return query; }),
      lt: vi.fn((key: "expense_date", value: string) => { selected = selected.filter((item) => item[key] < value); return query; }),
      or: vi.fn((predicate: string) => {
        membership = predicate;
        const selections = [...predicate.matchAll(/(category|subtype)\.in\.\(([^)]+)\)/g)];
        selected = selected.filter((item) => selections.some((match) => match[2].split(",").includes(String(item[match[1] as "category" | "subtype"]))));
        return query;
      }),
      order: vi.fn((key: string) => { orders.push(key); return query; }),
      range: vi.fn(async (start: number, end: number) => {
        requests.push({ owner, membership, orders, range: [start, end] });
        if (requests.length === failPage) return { data: null, error: new Error("private failure"), count: null };
        selected.sort((a, b) => b.expense_date.localeCompare(a.expense_date) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        return { data: selected.slice(start, Math.min(end + 1, start + cap)), error: null, count: selected.length };
      }),
    };
    return query;
  }) };
}

describe("complete custom ledgers", () => {
  beforeEach(() => { vi.resetAllMocks(); requests = []; mocks.createClient.mockResolvedValue(clientFor(fixtures)); });
  it("parent membership includes subtypes and subtype-free records with owner scoping", async () => {
    const expenses = await getExpenseTabExpensesForUser("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);
    expect(expenses.map((item) => item.id)).toEqual(["e", "d", "c", "b", "a"]);
    expect(expenses.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(16.50);
    expect(requests[0]).toMatchObject({ owner: "owner", orders: ["expense_date", "created_at", "id"] });
  });
  it("child-only membership excludes its siblings and subtype-free records", async () => {
    const expenses = await getExpenseTabExpensesForUser("owner", { ...tab, categoryKeys: [], subtypeKeys: ["car_fuel"] }, DEFAULT_EXPENSE_TAB_FILTERS);
    expect(expenses.map((item) => item.id)).toEqual(["b"]);
  });
  it("one OR predicate returns parent-child overlaps once", async () => {
    const expenses = await getExpenseTabExpensesForUser("owner", { ...tab, subtypeKeys: ["car_fuel"] }, DEFAULT_EXPENSE_TAB_FILTERS);
    expect(new Set(expenses.map((item) => item.id)).size).toBe(5);
    expect(expenses).toHaveLength(5);
    expect(requests[0].membership).toBe("category.in.(car),subtype.in.(car_fuel)");
  });
  it("includes year start and last day, excluding adjacent years", async () => {
    const expenses = await getExpenseTabExpensesForUser("owner", tab, { ...DEFAULT_EXPENSE_TAB_FILTERS, scope: "year", year: 2025 });
    expect(expenses.map((item) => item.id)).toEqual(["c", "b"]);
    expect(expenses.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(5.50);
  });
  it("includes both ends of a calendar date range", async () => {
    const expenses = await getExpenseTabExpensesForUser("owner", tab, { ...DEFAULT_EXPENSE_TAB_FILTERS, scope: "range", startDate: "2024-12-31", endDate: "2025-01-01" });
    expect(expenses.map((item) => item.id)).toEqual(["b", "a"]);
  });
  it("specific subtype, no subtype, category and search only narrow membership", async () => {
    expect((await getExpenseTabExpensesForUser("owner", tab, { ...DEFAULT_EXPENSE_TAB_FILTERS, subtype: "none" })).map((item) => item.id)).toEqual(["e", "a"]);
    expect((await getExpenseTabExpensesForUser("owner", tab, { ...DEFAULT_EXPENSE_TAB_FILTERS, subtype: "car_fuel", search: "FUEL" })).map((item) => item.id)).toEqual(["b"]);
    expect((await getExpenseTabExpensesForUser("owner", tab, { ...DEFAULT_EXPENSE_TAB_FILTERS, search: "garage" })).map((item) => item.id)).toEqual(["c"]);
    expect(await getExpenseTabExpensesForUser("owner", tab, { ...DEFAULT_EXPENSE_TAB_FILTERS, category: "transport" })).toEqual([]);
    expect(await getExpenseTabExpensesForUser("owner", { ...tab, categoryKeys: [], subtypeKeys: ["car_fuel"] }, { ...DEFAULT_EXPENSE_TAB_FILTERS, subtype: "none" })).toEqual([]);
  });
  it("fetches all history even above 1000 rows with a lower server cap and searches after retrieval", async () => {
    const rows = Array.from({ length: 1207 }, (_, index) => row(String(index).padStart(4, "0"), "car_fuel", "2025-01-01", "0.01"));
    rows[0].description = "Rare last-page match";
    mocks.createClient.mockResolvedValue(clientFor(rows, 113));
    const expenses = await getExpenseTabExpensesForUser("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS);
    expect(expenses).toHaveLength(1207);
    expect(new Set(expenses.map((item) => item.id)).size).toBe(1207);
    expect(expenses.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(12.07);
    expect(requests).toHaveLength(11);
    expect(requests[1].range).toEqual([113, 612]);
    expect(requests.every((request) => request.owner === "owner")).toBe(true);
    const matches = await getExpenseTabExpensesForUser("owner", tab, { ...DEFAULT_EXPENSE_TAB_FILTERS, search: "rare" });
    expect(matches.map((item) => item.id)).toEqual(["0000"]);
  });
  it("fails the entire retrieval when a later page errors", async () => {
    mocks.createClient.mockResolvedValue(clientFor(fixtures, 2, 2));
    await expect(getExpenseTabExpensesForUser("owner", tab, DEFAULT_EXPENSE_TAB_FILTERS)).rejects.toThrow("Unable to load expenses.");
  });
  it("never broadens an empty membership into all expenses", async () => {
    expect(await getExpenseTabExpensesForUser("owner", { ...tab, categoryKeys: [], subtypeKeys: [] }, DEFAULT_EXPENSE_TAB_FILTERS)).toEqual([]);
    expect(requests).toEqual([]);
  });
});
