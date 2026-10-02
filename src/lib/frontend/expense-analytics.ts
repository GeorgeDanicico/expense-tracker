import {
  CATEGORY_LABELS,
  type Analytics,
  type AnalyticsFilters,
  type Expense,
} from "@/lib/types";
import { getCurrentMonth, getMonthRange, shiftMonth } from "@/lib/utils/dates";

export function compareAmounts(current: number, previous: number) {
  return {
    difference: current - previous,
    percentage: previous === 0 ? null : ((current - previous) / previous) * 100,
  };
}

export function categoryShares(items: Analytics["categoryTotals"]) {
  const total = items.reduce((sum, item) => sum + item.total, 0);
  return items
    .toSorted((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .map((item) => ({
      ...item,
      share: total === 0 ? 0 : (item.total / total) * 100,
    }));
}

export function monthAnalytics(expenses: Expense[], month: string) {
  const totals = new Map<Expense["category"], number>();
  const days = new Map<string, number>();
  let total = 0;
  let largest = 0;
  for (const expense of expenses) {
    total += expense.amount;
    largest = Math.max(largest, expense.amount);
    totals.set(
      expense.category,
      (totals.get(expense.category) ?? 0) + expense.amount,
    );
    days.set(
      expense.expenseDate,
      (days.get(expense.expenseDate) ?? 0) + expense.amount,
    );
  }
  const { month: safeMonth, endExclusive } = getMonthRange(month);
  const end = new Date(`${endExclusive}T12:00:00`);
  end.setDate(0);
  const daily = Array.from({ length: end.getDate() }, (_, i) => {
    const key = `${safeMonth}-${String(i + 1).padStart(2, "0")}`;
    return { key, label: String(i + 1), total: days.get(key) ?? 0 };
  });
  const categories = categoryShares(
    [...totals].map(([category, amount]) => ({
      category,
      label: CATEGORY_LABELS[category],
      total: amount,
    })),
  );
  return {
    total,
    count: expenses.length,
    average: expenses.length ? total / expenses.length : 0,
    largest,
    daily,
    categories,
    concentration: categories
      .slice(0, 3)
      .reduce((sum, item) => sum + item.share, 0),
    ranked: expenses
      .toSorted(
        (a, b) =>
          b.amount - a.amount ||
          b.expenseDate.localeCompare(a.expenseDate) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 5),
  };
}

export function categoryComparisons(
  current: Analytics["categoryTotals"],
  previous: Analytics["categoryTotals"],
) {
  const before = new Map(previous.map((item) => [item.category, item]));
  const after = new Map(current.map((item) => [item.category, item]));
  return [...new Set([...after.keys(), ...before.keys()])]
    .map((category) => {
      const item = after.get(category) ?? before.get(category)!;
      return {
        category,
        label: item.label,
        ...compareAmounts(
          after.get(category)?.total ?? 0,
          before.get(category)?.total ?? 0,
        ),
      };
    })
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

export function seriesInsights(series: Analytics["series"]) {
  if (!series.length)
    return { highest: [], lowest: [], average: 0, changes: [] };
  const highest = Math.max(...series.map((item) => item.total));
  const lowest = Math.min(...series.map((item) => item.total));
  return {
    highest: series.filter((item) => item.total === highest),
    lowest: series.filter((item) => item.total === lowest),
    average: series.reduce((sum, item) => sum + item.total, 0) / series.length,
    changes: series
      .slice(1)
      .map((item, i) => ({
        key: item.key,
        previousKey: series[i].key,
        ...compareAmounts(item.total, series[i].total),
      })),
  };
}

export function historyBoundaries(
  filters: AnalyticsFilters,
  currentMonth = getCurrentMonth(),
) {
  if (filters.period === "custom" && filters.granularity === "day")
    return { start: filters.customDate, end: filters.customDate };
  const months = { "3m": 3, "6m": 6, "1y": 12, "2y": 24 };
  const startMonth =
    filters.period === "custom"
      ? filters.customDate
      : shiftMonth(currentMonth, -months[filters.period]);
  const endExclusive =
    filters.period === "custom"
      ? getMonthRange(startMonth).endExclusive
      : `${currentMonth}-01`;
  const end = new Date(`${endExclusive}T12:00:00`);
  end.setDate(end.getDate() - 1);
  return {
    start: `${startMonth}-01`,
    end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`,
  };
}
