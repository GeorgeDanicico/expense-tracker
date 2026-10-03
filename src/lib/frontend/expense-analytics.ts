import Decimal from "decimal.js";
import {
  CATEGORY_LABELS,
  SUBTYPE_LABELS,
  type Analytics,
  type AnalyticsFilters,
  type Expense,
} from "@/lib/types";
import type { ExpenseTabFilters } from "@/lib/expenses/tab-filters";
import {
  formatDate,
  formatMonth,
  getCurrentMonth,
  getMonthRange,
  shiftMonth,
} from "@/lib/utils/dates";

export function compareAmounts(current: number, previous: number) {
  return {
    difference: current - previous,
    percentage: previous === 0 ? null : ((current - previous) / previous) * 100,
  };
}

type ShareItem = { label: string; total: number } &
  ({ category: string } | { groupKey: string });

export function categoryShares<T extends ShareItem>(items: T[]) {
  const total = items.reduce(
    (sum, item) => sum.plus(item.total),
    new Decimal(0),
  );
  return items
    .toSorted((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .map((item) => ({
      ...item,
      share: total.isZero()
        ? 0
        : new Decimal(item.total).div(total).mul(100).toNumber(),
    }));
}

type ExpenseTabBucket = {
  groupKey: string;
  label: string;
  total: number;
};

type ExpenseTabSeriesBucket = { key: string; label: string; total: number };

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthIndex(month: string) {
  const [year, number] = month.split("-").map(Number);
  return year * 12 + number - 1;
}

function monthFromIndex(index: number) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function periodLabel(
  label: string,
  actualStart: string,
  actualEnd: string,
  periodStart: string,
  periodEnd: string,
) {
  if (actualStart === periodStart && actualEnd === periodEnd) return label;
  return `${label} (${formatDate(actualStart)} – ${formatDate(actualEnd)})`;
}

function makeTimeSeries(
  totals: Map<string, Decimal>,
  filters: ExpenseTabFilters,
  firstDate: string | null,
  lastDate: string | null,
): ExpenseTabSeriesBucket[] {
  if (filters.scope === "year") {
    return Array.from({ length: 12 }, (_, index) => {
      const key = `${String(filters.year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`;
      return {
        key,
        label: formatMonth(key),
        total: (totals.get(key) ?? new Decimal(0)).toNumber(),
      };
    });
  }

  if (filters.scope === "all") {
    if (!firstDate || !lastDate) return [];
    const firstYear = Number(firstDate.slice(0, 4));
    const lastYear = Number(lastDate.slice(0, 4));
    return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => {
      const key = String(firstYear + index).padStart(4, "0");
      return {
        key,
        label: key,
        total: (totals.get(key) ?? new Decimal(0)).toNumber(),
      };
    });
  }

  if (rangeUsesYears(filters)) {
    const firstYear = Number(filters.startDate.slice(0, 4));
    const lastYear = Number(filters.endDate.slice(0, 4));
    return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => {
      const key = String(firstYear + index).padStart(4, "0");
      const periodStart = `${key}-01-01`;
      const periodEnd = `${key}-12-31`;
      const actualStart = filters.startDate > periodStart ? filters.startDate : periodStart;
      const actualEnd = filters.endDate < periodEnd ? filters.endDate : periodEnd;
      return {
        key,
        label: periodLabel(key, actualStart, actualEnd, periodStart, periodEnd),
        total: (totals.get(key) ?? new Decimal(0)).toNumber(),
      };
    });
  }

  const firstMonth = monthKey(filters.startDate);
  const lastMonth = monthKey(filters.endDate);
  const firstIndex = monthIndex(firstMonth);
  const lastIndex = monthIndex(lastMonth);
  return Array.from({ length: lastIndex - firstIndex + 1 }, (_, index) => {
    const key = monthFromIndex(firstIndex + index);
    const periodStart = `${key}-01`;
    const periodEnd = `${key}-${String(daysInMonth(key)).padStart(2, "0")}`;
    const actualStart = filters.startDate > periodStart ? filters.startDate : periodStart;
    const actualEnd = filters.endDate < periodEnd ? filters.endDate : periodEnd;
    return {
      key,
      label: periodLabel(formatMonth(key), actualStart, actualEnd, periodStart, periodEnd),
      total: (totals.get(key) ?? new Decimal(0)).toNumber(),
    };
  });
}

/** Use yearly buckets for date ranges longer than two calendar years. */
function rangeUsesYears(filters: Extract<ExpenseTabFilters, { scope: "range" }>) {
  return monthIndex(monthKey(filters.endDate)) - monthIndex(monthKey(filters.startDate)) + 1 > 24;
}

function breakdownGroup(expense: Expense): { groupKey: string; label: string } {
  if (expense.subtype) {
    return {
      groupKey: `subtype:${expense.subtype}`,
      label: SUBTYPE_LABELS[expense.subtype],
    };
  }
  return {
    groupKey: `category:${expense.category}:no-subtype`,
    label: `${CATEGORY_LABELS[expense.category]} (no subtype)`,
  };
}

/**
 * Summarize the exact filtered rows returned for a custom expense tab. Decimal
 * arithmetic keeps the total, time series, and categorical buckets in sync.
 */
export function expenseTabAnalytics(expenses: Expense[], filters: ExpenseTabFilters) {
  const timeTotals = new Map<string, Decimal>();
  const groups = new Map<string, { label: string; total: Decimal }>();
  let total = new Decimal(0);
  let firstDate = expenses[0]?.expenseDate ?? "";
  let lastDate = firstDate;
  const yearly = filters.scope === "all" || (filters.scope === "range" && rangeUsesYears(filters));

  for (const expense of expenses) {
    const amount = new Decimal(expense.amount);
    total = total.plus(amount);
    const timeKey = yearly ? expense.expenseDate.slice(0, 4) : monthKey(expense.expenseDate);
    timeTotals.set(
      timeKey,
      (timeTotals.get(timeKey) ?? new Decimal(0)).plus(amount),
    );
    if (expense.expenseDate < firstDate) firstDate = expense.expenseDate;
    if (expense.expenseDate > lastDate) lastDate = expense.expenseDate;
    const { groupKey, label } = breakdownGroup(expense);
    const group = groups.get(groupKey);
    groups.set(groupKey, {
      label,
      total: (group?.total ?? new Decimal(0)).plus(amount),
    });
  }

  const timeSeries = makeTimeSeries(timeTotals, filters, firstDate, lastDate);
  const breakdown: ExpenseTabBucket[] = [...groups]
    .map(([groupKey, group]) => ({
      groupKey,
      label: group.label,
      total: group.total.toNumber(),
    }))
    .toSorted((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  return {
    total: total.toNumber(),
    count: expenses.length,
    average: expenses.length ? total.div(expenses.length).toNumber() : 0,
    series: timeSeries,
    breakdown,
  };
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
