import { describe, expect, it } from "vitest";
import {
  categoryComparisons,
  categoryShares,
  compareAmounts,
  historyBoundaries,
  monthAnalytics,
  seriesInsights,
} from "@/lib/frontend/expense-analytics";
import type { Expense } from "@/lib/types";

const expense = (overrides: Partial<Expense> = {}): Expense => ({
  id: "1",
  description: "Groceries",
  amount: 10,
  category: "groceries",
  expenseDate: "2024-02-01",
  notes: null,
  ...overrides,
});

describe("recorded monthly analytics", () => {
  it("fills every day in an empty leap-year month with zero", () => {
    const data = monthAnalytics([], "2024-02");
    expect(data).toMatchObject({
      total: 0,
      count: 0,
      average: 0,
      largest: 0,
      categories: [],
      ranked: [],
      concentration: 0,
    });
    expect(data.daily).toHaveLength(29);
    expect(data.daily[28]).toEqual({
      key: "2024-02-29",
      label: "29",
      total: 0,
    });
  });
  it("handles ordinary February and year boundaries", () => {
    expect(monthAnalytics([], "2023-02").daily).toHaveLength(28);
    expect(monthAnalytics([], "2026-12").daily.at(-1)?.key).toBe("2026-12-31");
    expect(monthAnalytics([], "2027-01").daily[0].key).toBe("2027-01-01");
  });
  it("derives one recorded expense and its category share", () => {
    const data = monthAnalytics([expense()], "2024-02");
    expect(data).toMatchObject({
      total: 10,
      count: 1,
      average: 10,
      largest: 10,
      concentration: 100,
    });
    expect(data.categories[0]).toMatchObject({
      label: "Groceries",
      total: 10,
      share: 100,
    });
    expect(data.daily[0].total).toBe(10);
    expect(data.daily[1].total).toBe(0);
  });
  it("aggregates days and categories, ranks five largest without mutating rows", () => {
    const rows = [
      expense({ id: "a", amount: 15 }),
      expense({ id: "b", amount: 20 }),
      expense({ id: "c", amount: 30, category: "housing" }),
      expense({
        id: "d",
        amount: 25,
        category: "housing",
        expenseDate: "2024-02-29",
      }),
      expense({ id: "e", amount: 5, category: "transport" }),
      expense({ id: "f", amount: 10, category: "other" }),
    ];
    const original = [...rows];
    const data = monthAnalytics(rows, "2024-02");
    expect(data.total).toBe(105);
    expect(data.daily[0].total).toBe(80);
    expect(data.daily[28].total).toBe(25);
    expect(data.categories[0].total).toBe(55);
    expect(data.ranked.map((row) => row.id)).toEqual(["c", "d", "b", "a", "f"]);
    expect(data.concentration).toBeCloseTo((100 * 100) / 105);
    expect(rows).toEqual(original);
  });
  it("breaks ranking ties by date then id", () => {
    expect(
      monthAnalytics(
        [
          expense({ id: "b" }),
          expense({ id: "a" }),
          expense({ id: "c", expenseDate: "2024-02-02" }),
        ],
        "2024-02",
      ).ranked.map((row) => row.id),
    ).toEqual(["c", "a", "b"]);
  });
});

describe("shares and comparisons", () => {
  it("sorts category shares with stable label ties and zero totals", () => {
    expect(
      categoryShares([
        { category: "groceries", label: "Groceries", total: 10 },
        { category: "education", label: "Education", total: 10 },
      ]).map((row) => [row.label, row.share]),
    ).toEqual([
      ["Education", 50],
      ["Groceries", 50],
    ]);
    expect(
      categoryShares([{ category: "other", label: "Other", total: 0 }])[0]
        .share,
    ).toBe(0);
    expect(categoryShares([])).toEqual([]);
  });
  it("returns an absolute difference with no percentage for zero baselines", () => {
    expect(compareAmounts(10, 0)).toEqual({ difference: 10, percentage: null });
    expect(compareAmounts(0, 0)).toEqual({ difference: 0, percentage: null });
    expect(compareAmounts(50, 100)).toEqual({
      difference: -50,
      percentage: -50,
    });
    expect(compareAmounts(200, 100)).toEqual({
      difference: 100,
      percentage: 100,
    });
  });
  it("includes categories appearing in either month", () => {
    const changes = categoryComparisons(
      [{ category: "groceries", label: "Groceries", total: 20 }],
      [{ category: "housing", label: "Housing", total: 100 }],
    );
    expect(changes).toEqual([
      {
        category: "groceries",
        label: "Groceries",
        difference: 20,
        percentage: null,
      },
      {
        category: "housing",
        label: "Housing",
        difference: -100,
        percentage: -100,
      },
    ]);
  });
});

describe("historical series", () => {
  it("handles empty and single-month series", () => {
    expect(seriesInsights([])).toEqual({
      highest: [],
      lowest: [],
      average: 0,
      changes: [],
    });
    expect(
      seriesInsights([{ key: "2026-01", label: "Jan", total: 10 }]),
    ).toMatchObject({ average: 10, changes: [] });
  });
  it("includes zero months in averages and extrema and preserves ties", () => {
    const series = [
      { key: "2026-01", label: "Jan", total: 0 },
      { key: "2026-02", label: "Feb", total: 100 },
      { key: "2026-03", label: "Mar", total: 100 },
    ];
    const data = seriesInsights(series);
    expect(data.average).toBeCloseTo(200 / 3);
    expect(data.highest).toHaveLength(2);
    expect(data.lowest).toEqual([series[0]]);
    expect(data.changes[0]).toMatchObject({
      difference: 100,
      percentage: null,
    });
    expect(data.changes[1]).toMatchObject({ difference: 0, percentage: 0 });
  });
  it("defines previous completed period boundaries across years", () => {
    expect(
      historyBoundaries(
        { period: "3m", granularity: "month", customDate: "2026-01" },
        "2026-01",
      ),
    ).toEqual({ start: "2025-10-01", end: "2025-12-31" });
    expect(
      historyBoundaries(
        { period: "2y", granularity: "month", customDate: "2026-01" },
        "2026-01",
      ),
    ).toEqual({ start: "2024-01-01", end: "2025-12-31" });
  });
  it("defines a custom leap month or a single day", () => {
    expect(
      historyBoundaries({
        period: "custom",
        granularity: "month",
        customDate: "2024-02",
      }),
    ).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(
      historyBoundaries({
        period: "custom",
        granularity: "day",
        customDate: "2024-02-29",
      }),
    ).toEqual({ start: "2024-02-29", end: "2024-02-29" });
  });
});
