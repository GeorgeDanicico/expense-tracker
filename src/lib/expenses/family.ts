import Decimal from "decimal.js";

import type { CurrencyTotals } from "@/lib/expenses/types";

/** Figures that belong to one currency; a member's month, or a single expense (`count: 1`). */
export type CurrencyFigures = { currency: string; total: number; count: number; largest: number };

/**
 * Adds up figures per currency, with no conversion: 1,240 RON and 85 EUR stay two entries.
 * The biggest total comes first (then the currency code), so the main currency leads. Decimal
 * arithmetic keeps the sums exact.
 */
export function groupByCurrency(entries: CurrencyFigures[]): CurrencyTotals[] {
  const groups = new Map<string, { total: Decimal; count: number; largest: number }>();
  for (const entry of entries) {
    const group = groups.get(entry.currency) ?? { total: new Decimal(0), count: 0, largest: 0 };
    groups.set(entry.currency, {
      total: group.total.plus(entry.total),
      count: group.count + entry.count,
      largest: Math.max(group.largest, entry.largest),
    });
  }
  return [...groups]
    .map(([currency, { total, count, largest }]) => ({
      currency,
      total: total.toNumber(),
      count,
      average: count ? total.div(count).toNumber() : 0,
      largest,
    }))
    .toSorted((a, b) => b.total - a.total || a.currency.localeCompare(b.currency));
}

/** Newest first by date, then by member name and id, so the order is the same on every request. */
export function compareFamilyExpenses(
  a: { expenseDate: string; memberName: string; id: string },
  b: { expenseDate: string; memberName: string; id: string },
) {
  return b.expenseDate.localeCompare(a.expenseDate) || a.memberName.localeCompare(b.memberName) || a.id.localeCompare(b.id);
}
