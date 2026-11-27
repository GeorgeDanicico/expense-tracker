import { addMonths, daysInMonth } from "@/lib/calendar";
import { CATEGORY_LABELS, SUBTYPE_LABELS, type ExpenseCategory } from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";
import { merchantOf } from "@/lib/insights/merchants";

/** What a spending change is about: a category, a car subtype or a merchant. */
export type ChangeKind = "category" | "subtype" | "merchant";

export type SpendingChange = {
  kind: ChangeKind;
  /** Unique within its kind: the category, the subtype or the merchant key. */
  key: string;
  label: string;
  /** The category it belongs to (a merchant's most used one), for its icon. */
  category: ExpenseCategory;
  /** Spent in the month (up to `throughDay` for the current month). */
  current: number;
  /** Spent in the month before, over the same days. */
  previous: number;
  /** The average of the months before, over the same days; null with no earlier month to average. */
  average: number | null;
  /** `current - previous`. */
  difference: number;
  /** Percent change from `previous`; null when `previous` is 0. */
  change: number | null;
  /** Percent change from `average`; null when there is no average or it is 0. */
  averageChange: number | null;
};

export type SpendingChanges = {
  month: string;
  previousMonth: string;
  /** For the current month, the day it's compared up to (each earlier month up to the same day); null for a finished month. */
  throughDay: number | null;
  /** The whole month's spending, compared the same way. */
  total: Omit<SpendingChange, "kind" | "key" | "label" | "category">;
  /** The notable changes, biggest first (`isNotable`). */
  changes: SpendingChange[];
};

/** How many months before the month the average covers. */
export const AVERAGE_MONTHS = 3;
/** A change counts when it's at least this share of the month before's total... */
export const MIN_SHARE_OF_TOTAL = 0.03;
/** ...and at least this many percent (a new expense with nothing before always counts once it's big enough). */
export const MIN_PERCENT = 15;

const cents = (value: number) => Math.round(value * 100) / 100;
const percent = (current: number, base: number | null) => (base ? Math.round(((current - base) / base) * 100) : null);

/** The first month `spendingChanges` needs: the average's first month. */
export function changesStartMonth(month: string) {
  return addMonths(month, -AVERAGE_MONTHS);
}

type Bucket = { label: string; categories: Map<ExpenseCategory, number>; totals: number[] };

/**
 * How `month` compares with the month before and with the average of the `AVERAGE_MONTHS` before it,
 * per category, car subtype and merchant (`merchantOf`), keeping the notable changes.
 *
 * `expenses` must cover `changesStartMonth(month)` to the end of `month`; others are ignored. For the
 * month `today` is in, each month is compared up to today's day of the month, so a half-finished month
 * isn't set against whole ones. Months before the first expense in `expenses` aren't averaged: they
 * would only say the person wasn't using the app yet.
 */
export function spendingChanges(expenses: readonly Expense[], month: string, today: string): SpendingChanges {
  const months = Array.from({ length: AVERAGE_MONTHS + 1 }, (_, index) => addMonths(month, -index));
  const throughDay = today.startsWith(`${month}-`) ? Number(today.slice(8)) : null;
  const firstMonth = expenses.reduce((first, expense) => (expense.expenseDate.slice(0, 7) < first ? expense.expenseDate.slice(0, 7) : first), month);
  const averaged = months.slice(1).filter((key) => key >= firstMonth);

  const buckets = new Map<string, Bucket>();
  const add = (id: string, label: string, category: ExpenseCategory, index: number, amount: number) => {
    const bucket = buckets.get(id) ?? { label, categories: new Map(), totals: months.map(() => 0) };
    bucket.totals[index] += amount;
    bucket.categories.set(category, (bucket.categories.get(category) ?? 0) + 1);
    buckets.set(id, bucket);
  };

  const totals = months.map(() => 0);
  for (const expense of expenses) {
    const index = months.indexOf(expense.expenseDate.slice(0, 7));
    if (index < 0) continue;
    if (throughDay !== null && Number(expense.expenseDate.slice(8)) > Math.min(throughDay, daysInMonth(months[index]))) continue;
    totals[index] += expense.amount;
    add(`category:${expense.category}`, CATEGORY_LABELS[expense.category], expense.category, index, expense.amount);
    if (expense.subtype) add(`subtype:${expense.subtype}`, SUBTYPE_LABELS[expense.subtype], expense.category, index, expense.amount);
    const merchant = merchantOf(expense.description);
    if (merchant) add(`merchant:${merchant.key}`, merchant.label, expense.category, index, expense.amount);
  }

  const compare = (values: number[]) => {
    const [current, previous] = [cents(values[0]), cents(values[1])];
    const average = averaged.length ? cents(averaged.reduce((sum, key) => sum + values[months.indexOf(key)], 0) / averaged.length) : null;
    return { current, previous, average, difference: cents(current - previous), change: percent(current, previous), averageChange: percent(current, average) };
  };

  const previousTotal = totals[1];
  const changes = [...buckets]
    .map(([id, bucket]): SpendingChange => {
      const separator = id.indexOf(":");
      return {
        kind: id.slice(0, separator) as ChangeKind,
        key: id.slice(separator + 1),
        label: bucket.label,
        category: [...bucket.categories].toSorted((a, b) => b[1] - a[1])[0][0],
        ...compare(bucket.totals),
      };
    })
    .filter((item) => isNotable(item, previousTotal))
    .toSorted((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label));

  return { month, previousMonth: months[1], throughDay, total: compare(totals), changes: withoutRepeats(changes) };
}

const KIND_ORDER: Record<ChangeKind, number> = { category: 0, subtype: 1, merchant: 2 };

/**
 * Whether a change is worth showing: big against the month before's whole spending (`MIN_SHARE_OF_TOTAL`)
 * and, when there was spending before, by at least `MIN_PERCENT`. Nothing counts without a month before.
 */
export function isNotable(item: Pick<SpendingChange, "difference" | "change">, previousTotal: number) {
  if (previousTotal <= 0) return false;
  if (Math.abs(item.difference) < previousTotal * MIN_SHARE_OF_TOTAL) return false;
  return item.change === null || Math.abs(item.change) >= MIN_PERCENT;
}

/**
 * Drops a subtype or merchant that only repeats a broader change already listed with the same amounts:
 * the car's fuel when the car had nothing else, Kaufland when it's the only grocery shop.
 */
function withoutRepeats(changes: SpendingChange[]) {
  const seen = new Set<string>();
  return changes.filter((item) => {
    const amounts = `${item.category}|${item.current}|${item.previous}`;
    if (seen.has(amounts)) return false;
    seen.add(amounts);
    return true;
  });
}
