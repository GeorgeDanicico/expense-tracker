import { getMonthRange } from "@/lib/calendar";
import { changesStartMonth, spendingChanges, type SpendingChanges } from "@/lib/insights/changes";
import { recurringPayments, recurringStartMonth, type RecurringPayments } from "@/lib/insights/recurring";
import { getRepositories } from "@/lib/repositories";

/** What `GET /api/insights` answers for one person and month, before `viewing` is added. */
export type SpendingInsights = { month: string; changes: SpendingChanges; recurring: RecurringPayments };

/**
 * `userId`'s spending changes and recurring payments for `month`, from one read of the months both
 * need (the recurring payments look further back than the comparisons' average).
 */
export async function getSpendingInsights(userId: string, month: string, today: string): Promise<SpendingInsights> {
  const first = [changesStartMonth(month), recurringStartMonth(month)].toSorted()[0];
  const expenses = await getRepositories().expenses.listRange(userId, {
    start: getMonthRange(first).start,
    endExclusive: getMonthRange(month).endExclusive,
  });
  return { month, changes: spendingChanges(expenses, month, today), recurring: recurringPayments(expenses, month) };
}
