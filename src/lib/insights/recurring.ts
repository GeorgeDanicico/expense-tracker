import { addMonths } from "@/lib/calendar";
import type { ExpenseCategory } from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";
import { merchantOf } from "@/lib/insights/merchants";

export type RecurringPayment = {
  /** The merchant key (`merchantOf`). */
  key: string;
  label: string;
  category: ExpenseCategory;
  /** The latest month's charge. */
  amount: number;
  /** The charge the month before the latest; it differs from `amount` when the price changed. */
  previousAmount: number;
  /** Months in a row it was charged, up to the latest. */
  months: number;
  /** The latest month it was charged (`YYYY-MM`): the month itself, or the month before when it isn't charged yet. */
  lastMonth: string;
  /** Whether it was charged in the month itself. */
  charged: boolean;
};

export type RecurringPayments = {
  month: string;
  /** Biggest first. */
  payments: RecurringPayment[];
  /** What they cost a month: the sum of each one's latest charge. */
  monthlyTotal: number;
};

/** How many months before the month are searched. */
export const RECURRING_LOOKBACK_MONTHS = 6;
/** Charged in at least this many months in a row... */
export const MIN_RECURRING_MONTHS = 3;
/** ...with each month's charge within this share of their median... */
export const MAX_AMOUNT_SPREAD = 0.25;
/** ...and at most this many charges a month on average (a weekly shop isn't a subscription). */
export const MAX_CHARGES_PER_MONTH = 1.5;

const cents = (value: number) => Math.round(value * 100) / 100;

/** The first month `recurringPayments` needs. */
export function recurringStartMonth(month: string) {
  return addMonths(month, -RECURRING_LOOKBACK_MONTHS);
}

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The payments that look recurring as of `month`: the same merchant (`merchantOf`) charged in at least
 * `MIN_RECURRING_MONTHS` months in a row, about once a month, for about the same amount. The run must
 * reach `month`, or the month before when `month` hasn't been charged yet (a subscription due later in
 * the month still counts). `expenses` must cover `recurringStartMonth(month)` to the end of `month`.
 */
export function recurringPayments(expenses: readonly Expense[], month: string): RecurringPayments {
  const first = recurringStartMonth(month);
  const byMerchant = new Map<string, { label: string; categories: Map<ExpenseCategory, number>; months: Map<string, { total: number; count: number }> }>();
  for (const expense of expenses) {
    const key = expense.expenseDate.slice(0, 7);
    if (key < first || key > month) continue;
    const merchant = merchantOf(expense.description);
    if (!merchant) continue;
    const entry = byMerchant.get(merchant.key) ?? { label: merchant.label, categories: new Map(), months: new Map() };
    const totals = entry.months.get(key) ?? { total: 0, count: 0 };
    totals.total += expense.amount;
    totals.count += 1;
    entry.months.set(key, totals);
    entry.categories.set(expense.category, (entry.categories.get(expense.category) ?? 0) + 1);
    byMerchant.set(merchant.key, entry);
  }

  const payments: RecurringPayment[] = [];
  for (const [key, entry] of byMerchant) {
    const charged = entry.months.has(month);
    const lastMonth = charged ? month : addMonths(month, -1);
    const run: { total: number; count: number }[] = [];
    for (let at = lastMonth; at >= first && entry.months.has(at); at = addMonths(at, -1)) run.push(entry.months.get(at)!);
    if (run.length < MIN_RECURRING_MONTHS) continue;
    if (run.reduce((sum, item) => sum + item.count, 0) / run.length > MAX_CHARGES_PER_MONTH) continue;
    const middle = median(run.map((item) => item.total));
    if (run.some((item) => Math.abs(item.total - middle) > middle * MAX_AMOUNT_SPREAD)) continue;
    payments.push({
      key,
      label: entry.label,
      category: [...entry.categories].toSorted((a, b) => b[1] - a[1])[0][0],
      amount: cents(run[0].total),
      previousAmount: cents(run[1].total),
      months: run.length,
      lastMonth,
      charged,
    });
  }

  payments.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  return { month, payments, monthlyTotal: cents(payments.reduce((sum, payment) => sum + payment.amount, 0)) };
}
