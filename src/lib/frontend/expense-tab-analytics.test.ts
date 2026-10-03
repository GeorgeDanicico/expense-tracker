import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { expenseTabAnalytics } from "@/lib/frontend/expense-analytics";
import type { Expense } from "@/lib/types";
import type { ExpenseTabFilters } from "@/lib/expenses/tab-filters";

const expense = (overrides: Partial<Expense> = {}): Expense => ({
  id: "expense-1",
  description: "Recorded expense",
  amount: 1,
  category: "car",
  subtype: null,
  expenseDate: "2024-01-01",
  notes: null,
  ...overrides,
});

const allFilters: ExpenseTabFilters = {
  scope: "all",
  subtype: "all",
  category: null,
  search: "",
};

function decimalTotal(values: number[]) {
  return values.reduce((sum, amount) => sum.plus(amount), new Decimal(0));
}

describe("custom tab dashboard analytics", () => {
  it("reconciles exact totals across time and subtype buckets for unique filtered rows", () => {
    const rows = [
      expense({ id: "fuel", subtype: "car_fuel", amount: 0.1, expenseDate: "2024-01-03" }),
      expense({ id: "maintenance", subtype: "car_maintenance", amount: 0.2, expenseDate: "2024-02-03" }),
      expense({ id: "car-no-subtype", amount: 0.3, expenseDate: "2024-12-31" }),
      expense({ id: "groceries", category: "groceries", amount: 0.4, expenseDate: "2026-03-01" }),
      expense({ id: "repairs", subtype: "car_repairs", amount: 1.05, expenseDate: "2026-03-02" }),
    ];

    const result = expenseTabAnalytics(rows, allFilters);

    expect(result.count).toBe(5);
    expect(result.total).toBe(2.05);
    expect(decimalTotal(result.series.map((item) => item.total)).toString()).toBe("2.05");
    expect(decimalTotal(result.breakdown.map((item) => item.total)).toString()).toBe("2.05");
    expect(result.series).toEqual([
      { key: "2024", label: "2024", total: 0.6 },
      { key: "2025", label: "2025", total: 0 },
      { key: "2026", label: "2026", total: 1.45 },
    ]);
    expect(result.breakdown).toMatchObject([
      { groupKey: "subtype:car_repairs", label: "Car Repairs", total: 1.05 },
      { groupKey: "category:groceries:no-subtype", label: "Groceries (no subtype)", total: 0.4 },
      { groupKey: "category:car:no-subtype", label: "Car (no subtype)", total: 0.3 },
      { groupKey: "subtype:car_maintenance", label: "Car Maintenance", total: 0.2 },
      { groupKey: "subtype:car_fuel", label: "Car Fuel", total: 0.1 },
    ]);
  });

  it("fills all twelve months for a selected year, including zero buckets", () => {
    const result = expenseTabAnalytics(
      [
        expense({ id: "jan", amount: 5, expenseDate: "2025-01-10" }),
        expense({ id: "dec", amount: 7, expenseDate: "2025-12-10" }),
      ],
      { ...allFilters, scope: "year", year: 2025 },
    );

    expect(result.series).toHaveLength(12);
    expect(result.series[0]).toMatchObject({ key: "2025-01", total: 5 });
    expect(result.series[1]).toMatchObject({ key: "2025-02", total: 0 });
    expect(result.series[11]).toMatchObject({ key: "2025-12", total: 7 });
    expect(decimalTotal(result.series.map((item) => item.total)).toString()).toBe("12");
  });

  it("labels short date-range boundary months and keeps empty months", () => {
    const result = expenseTabAnalytics(
      [expense({ amount: 8, expenseDate: "2025-01-20" })],
      {
        ...allFilters,
        scope: "range",
        startDate: "2025-01-15",
        endDate: "2025-02-02",
      },
    );

    expect(result.series).toHaveLength(2);
    expect(result.series[0]).toMatchObject({
      key: "2025-01",
      label: expect.stringContaining("Jan 15, 2025"),
      total: 8,
    });
    expect(result.series[1]).toMatchObject({
      key: "2025-02",
      label: expect.stringContaining("Feb 02, 2025"),
      total: 0,
    });
    expect(decimalTotal(result.series.map((item) => item.total)).toString()).toBe("8");
  });

  it("uses yearly buckets for long ranges and labels partial years", () => {
    const result = expenseTabAnalytics(
      [expense({ amount: 4, expenseDate: "2020-06-30" })],
      {
        ...allFilters,
        scope: "range",
        startDate: "2020-06-15",
        endDate: "2023-04-10",
      },
    );

    expect(result.series).toHaveLength(4);
    expect(result.series[0]).toMatchObject({ key: "2020", total: 4 });
    expect(result.series[0].label).toContain("Jun 15, 2020");
    expect(result.series[1]).toMatchObject({ key: "2021", total: 0 });
    expect(result.series[2]).toMatchObject({ key: "2022", total: 0 });
    expect(result.series[3].label).toContain("Apr 10, 2023");
    expect(decimalTotal(result.series.map((item) => item.total)).toString()).toBe("4");
  });

  it("returns zero metrics and useful period buckets for empty filters", () => {
    const year = expenseTabAnalytics([], { ...allFilters, scope: "year", year: 2025 });
    const allTime = expenseTabAnalytics([], allFilters);

    expect(year).toMatchObject({ total: 0, count: 0, average: 0, breakdown: [] });
    expect(year.series).toHaveLength(12);
    expect(year.series.every((item) => item.total === 0)).toBe(true);
    expect(allTime).toMatchObject({ total: 0, count: 0, average: 0, series: [], breakdown: [] });
  });
});
