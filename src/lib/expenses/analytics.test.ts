import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  categoryComparisons,
  categoryShares,
  compareAmounts,
  expenseTabAnalytics,
  historyBoundaries,
  resolveAnalyticsRange,
  monthAnalytics,
  seriesInsights,
} from "@/lib/expenses/analytics";
import type { ExpenseTabFilters } from "@/lib/expenses/filters";
import type { Expense } from "@/lib/expenses/types";
import { anExpense } from "@/test/builders";


describe("recorded monthly analytics", () => {
  it("continues grouping Car expenses by their main category across subtypes", () => {
    const data = monthAnalytics([
      anExpense({ id: "fuel", category: "car", subtype: "car_fuel", amount: 20 }),
      anExpense({ id: "maintenance", category: "car", subtype: "car_maintenance", amount: 30 }),
      anExpense({ id: "unspecified", category: "car", subtype: null, amount: 5 }),
      anExpense({ id: "transport", category: "transport", amount: 10 }),
    ], "2024-02");
    expect(data.total).toBe(65);
    expect(data.categories).toMatchObject([
      { category: "car", label: "Car", total: 55 },
      { category: "transport", label: "Transport", total: 10 },
    ]);
  });

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
    const data = monthAnalytics([anExpense()], "2024-02");
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
      anExpense({ id: "a", amount: 15 }),
      anExpense({ id: "b", amount: 20 }),
      anExpense({ id: "c", amount: 30, category: "housing" }),
      anExpense({
        id: "d",
        amount: 25,
        category: "housing",
        expenseDate: "2024-02-29",
      }),
      anExpense({ id: "e", amount: 5, category: "transport" }),
      anExpense({ id: "f", amount: 10, category: "other" }),
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
          anExpense({ id: "b" }),
          anExpense({ id: "a" }),
          anExpense({ id: "c", expenseDate: "2024-02-02" }),
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

describe("custom tab dashboard analytics", () => {
  const carExpense = (overrides: Partial<Expense> = {}) =>
    anExpense({ description: "Recorded expense", amount: 1, category: "car", expenseDate: "2024-01-01", ...overrides });

  const allFilters: ExpenseTabFilters = {
    scope: "all",
    subtype: "all",
    category: null,
    search: "",
  };

  function decimalTotal(values: number[]) {
    return values.reduce((sum, amount) => sum.plus(amount), new Decimal(0));
  }

  it("reconciles exact totals across time and subtype buckets for unique filtered rows", () => {
    const rows = [
      carExpense({ id: "fuel", subtype: "car_fuel", amount: 0.1, expenseDate: "2024-01-03" }),
      carExpense({ id: "maintenance", subtype: "car_maintenance", amount: 0.2, expenseDate: "2024-02-03" }),
      carExpense({ id: "car-no-subtype", amount: 0.3, expenseDate: "2024-12-31" }),
      carExpense({ id: "groceries", category: "groceries", amount: 0.4, expenseDate: "2026-03-01" }),
      carExpense({ id: "repairs", subtype: "car_repairs", amount: 1.05, expenseDate: "2026-03-02" }),
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
        carExpense({ id: "jan", amount: 5, expenseDate: "2025-01-10" }),
        carExpense({ id: "dec", amount: 7, expenseDate: "2025-12-10" }),
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
      [carExpense({ amount: 8, expenseDate: "2025-01-20" })],
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
      [carExpense({ amount: 4, expenseDate: "2020-06-30" })],
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

describe("analytics range resolution", () => {
  it("gives the server range and the history boundaries the same dates for parsed filters", () => {
    const cases = [
      { period: "3m", granularity: "month", customDate: "2026-01" },
      { period: "2y", granularity: "month", customDate: "2026-01" },
      { period: "custom", granularity: "month", customDate: "2024-02" },
      { period: "custom", granularity: "day", customDate: "2024-12-31" },
    ] as const;
    for (const filters of cases) {
      const range = resolveAnalyticsRange(filters, "2026-01");
      const boundaries = historyBoundaries(filters, "2026-01");
      expect(boundaries.start).toBe(range.start);
      expect(range.endExclusive > boundaries.end).toBe(true);
    }
    expect(resolveAnalyticsRange(cases[3], "2026-01")).toMatchObject({
      start: "2024-12-31",
      endExclusive: "2025-01-01",
      granularity: "day",
    });
  });
  it("lets only the server fall back to the current month for an unparsed invalid custom date", () => {
    const day = { period: "custom", granularity: "day", customDate: "2024-02-30" } as const;
    expect(resolveAnalyticsRange(day, "2026-01")).toMatchObject({ start: "2026-01-01", endExclusive: "2026-02-01" });
    expect(historyBoundaries(day, "2026-01")).toEqual({ start: "2024-02-30", end: "2024-02-30" });
  });
});
