import { describe, expect, it } from "vitest";

import { DEFAULT_EXPENSE_TAB_FILTERS, expenseTabDateBounds } from "@/lib/expenses/tab-filters";
import { expenseTabExpensesApiKey } from "@/lib/api/keys";
import { expenseTabFilterParams, expenseTabHref, parseExpenseTabFilters, readExpenseTabFilters } from "./expense-tab-state";

const params = (query: string) => new URLSearchParams(query);

describe("custom expense filter state", () => {
  it("defaults to all time without inheriting the retained main month", () => {
    expect(readExpenseTabFilters(params("month=2026-10"))).toEqual(DEFAULT_EXPENSE_TAB_FILTERS);
  });
  it.each([
    "scope=year&year=2026&startDate=2026-01-01",
    "scope=range&year=2026&startDate=2026-01-01&endDate=2026-01-31",
    "scope=all&year=2026", "scope=year&year=2e03", "scope=year&year=2026.5",
    "scope=range&startDate=2025-02-29&endDate=2025-03-01",
    "scope=range&startDate=2026-03-02&endDate=2026-03-01",
    "scope=range&startDate=2026-04-31&endDate=2026-05-01",
    "scope=year", "scope=range", "subtype=invalid", "category=invalid", "scope=invalid",
  ])("rejects invalid or mixed filter modes: %s", (query) => {
    expect(parseExpenseTabFilters(params(query)).success).toBe(false);
  });
  it("round trips normalized explicit filters", () => {
    const parsed = parseExpenseTabFilters(params("scope=range&startDate=2024-02-29&endDate=2024-12-31&subtype=none&category=car&search=++garage++"));
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Invalid fixture");
    expect(parsed.data.search).toBe("garage");
    expect(readExpenseTabFilters(expenseTabFilterParams(parsed.data))).toEqual(parsed.data);
    expect(expenseTabDateBounds(parsed.data)).toEqual({ start: "2024-02-29", endExclusive: "2025-01-01" });
  });
  it("calculates year bounds and all-time absence of bounds", () => {
    expect(expenseTabDateBounds({ ...DEFAULT_EXPENSE_TAB_FILTERS, scope: "year", year: 2025 })).toEqual({ start: "2025-01-01", endExclusive: "2026-01-01" });
    expect(expenseTabDateBounds(DEFAULT_EXPENSE_TAB_FILTERS)).toEqual({});
  });
  it("normal tab clicks clear previous custom filters while retaining the main month", () => {
    const previous = params("month=2026-09&tab=old&scope=year&year=2025&subtype=none&search=garage");
    expect(expenseTabHref(previous, "new")).toBe("/expenses?month=2026-09&tab=new&scope=all");
    expect(expenseTabHref(previous, null)).toBe("/expenses?month=2026-09");
    expect(previous.get("year")).toBe("2025");
  });
  it("includes normalized filters and configuration revision in a stable cache key", () => {
    const key = expenseTabExpensesApiKey("tab", { ...DEFAULT_EXPENSE_TAB_FILTERS, subtype: "car_fuel", search: "OMV" }, "2026-10-03T00:00:00Z");
    const url = new URL(key, "http://localhost");
    expect(url.pathname).toBe("/api/expense-tabs/tab/expenses");
    expect(url.searchParams.get("revision")).toBe("2026-10-03T00:00:00Z");
    expect(url.searchParams.get("subtype")).toBe("car_fuel");
    expect(url.searchParams.has("month")).toBe(false);
    expect(expenseTabExpensesApiKey("tab", DEFAULT_EXPENSE_TAB_FILTERS, "new")).not.toBe(expenseTabExpensesApiKey("tab", DEFAULT_EXPENSE_TAB_FILTERS, "old"));
  });
});
