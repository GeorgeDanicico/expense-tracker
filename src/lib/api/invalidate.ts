import type { ScopedMutator } from "swr";

import {
  ACCOUNT_API_KEY,
  ACCOUNT_NOTICES_API_KEY,
  EXPENSE_TABS_API_KEY,
  FAMILY_API_KEY,
  FAMILY_INVITES_API_KEY,
  INVESTMENTS_API_KEY,
  NET_WORTH_API_KEY,
  expenseTabApiKey,
  expensesApiKey,
  mainExpensesApiKey,
  type FamilyResponse,
  type NoticesResponse,
  type TabsResponse,
} from "@/lib/api/keys";
import type { AccountData } from "@/lib/account/types";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { Expense, ExpensesData } from "@/lib/expenses/types";

// What to refresh after each mutation. Every helper takes the global `mutate`
// from `useSWRConfig()`. Retry buttons keep calling their own bound `mutate()`.

function startsWith(prefix: string) {
  return (key: unknown) => typeof key === "string" && key.startsWith(prefix);
}

function isTabLedgerKey(key: unknown) {
  return typeof key === "string" && key.startsWith(`${EXPENSE_TABS_API_KEY}/`) && key.includes("/expenses?");
}

function withExpenseAdded(expense: Expense) {
  return (current: ExpensesData | undefined) => {
    if (!current) return current;
    const expenses = [expense, ...current.expenses];
    const total = current.total + expense.amount;
    return { ...current, expenses, total, average: total / expenses.length };
  };
}

function withExpenseRemoved(id: string) {
  return (current: ExpensesData | undefined) => {
    if (!current?.expenses.some((expense) => expense.id === id)) return current;
    const expenses = current.expenses.filter((expense) => expense.id !== id);
    const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    return { ...current, expenses, total, average: expenses.length ? total / expenses.length : 0 };
  };
}

/** Background refresh of every view derived from expenses: tab ledgers and dashboards. */
export function afterExpenseChange(mutate: ScopedMutator) {
  void mutate(isTabLedgerKey);
  void mutate(startsWith("/api/dashboard?"));
}

/** Adds the new expense to the cached month ledgers of `month`, then refreshes derived views. */
export async function afterExpenseCreated(mutate: ScopedMutator, month: string, expense: Expense) {
  await mutate(expensesApiKey(month), withExpenseAdded(expense), { revalidate: false });
  await mutate(mainExpensesApiKey(month), withExpenseAdded(expense), { revalidate: false });
  afterExpenseChange(mutate);
}

/** Refetches every cached month ledger and derived view, after an expense added somewhere else (a reminder). */
export function afterExpenseLogged(mutate: ScopedMutator) {
  void mutate(startsWith("/api/expenses?"));
  afterExpenseChange(mutate);
}

/** Removes the expense from every cached month ledger, then refreshes derived views. */
export async function afterExpenseDeleted(mutate: ScopedMutator, id: string) {
  await mutate(startsWith("/api/expenses?"), withExpenseRemoved(id), { revalidate: false });
  afterExpenseChange(mutate);
}

/** Upserts the saved tab in the tab list; an edited tab's ledgers are refreshed. */
export async function afterTabSaved(mutate: ScopedMutator, saved: ExpenseTab, { editing }: { editing: boolean }) {
  await mutate(
    EXPENSE_TABS_API_KEY,
    (current: TabsResponse | undefined) => {
      const existing = current?.tabs ?? [];
      const tabs = editing
        ? existing.map((item) => item.id === saved.id ? saved : item)
        : [...existing.filter((item) => item.id !== saved.id), saved];
      return { tabs };
    },
    { revalidate: false },
  );
  if (editing) void mutate(startsWith(`${expenseTabApiKey(saved.id)}/expenses?`));
}

/** Drops the tab from the tab list and refreshes its ledgers. */
export async function afterTabDeleted(mutate: ScopedMutator, id: string) {
  await mutate(
    EXPENSE_TABS_API_KEY,
    (current: TabsResponse | undefined) => current
      ? { tabs: current.tabs.filter((item) => item.id !== id) }
      : current,
    { revalidate: false },
  );
  void mutate(startsWith(`${expenseTabApiKey(id)}/expenses?`));
}

/** Refreshes investments, net worth and, when given, the asset's transaction list. */
export function afterInvestmentChange(mutate: ScopedMutator, transactionsKey?: string) {
  const keys = [INVESTMENTS_API_KEY, NET_WORTH_API_KEY];
  if (transactionsKey) keys.push(transactionsKey);
  return Promise.allSettled(keys.map((key) => mutate(key)));
}

export function afterNetWorthChange(mutate: ScopedMutator) {
  return mutate(NET_WORTH_API_KEY);
}

export function afterSignIn(mutate: ScopedMutator) {
  return mutate(ACCOUNT_API_KEY);
}

/**
 * Clears `mustChangePassword` in the cached account, so the `(app)` layout stops sending the app to
 * `/change-password`. A plain `mutate(key)` isn't enough: it only refetches through mounted hooks, and
 * `/change-password` sits outside the `(app)` layout, so nothing there reads the account. The cache
 * would keep the stale `true`, and `/dashboard` would bounce straight back. The layout refetches the
 * account when it mounts.
 */
export function afterPasswordChange(mutate: ScopedMutator) {
  return mutate<AccountData>(ACCOUNT_API_KEY, (current) => current && { ...current, mustChangePassword: false });
}

/** After the caller's picture changes: their account (sidebar, settings) and the family list. */
export function invalidateAfterAvatarChange(mutate: ScopedMutator) {
  return Promise.all([mutate(ACCOUNT_API_KEY), mutate(FAMILY_API_KEY)]);
}

/** Clears every cached response without refetching. */
export function afterSignOut(mutate: ScopedMutator) {
  return mutate(() => true, undefined, { revalidate: false });
}

/** After creating or joining a family: caches the new family and reloads the account, whose membership changed. */
export async function afterFamilyJoined(mutate: ScopedMutator, response: FamilyResponse) {
  await mutate(FAMILY_API_KEY, response, { revalidate: false });
  await mutate(ACCOUNT_API_KEY);
}

/** Drops the dismissed notice from the cached list, so the next one shows without a refetch. */
export function afterNoticeDismissed(mutate: ScopedMutator, id: string) {
  return mutate(
    ACCOUNT_NOTICES_API_KEY,
    (current: NoticesResponse | undefined) => current
      ? { notices: current.notices.filter((notice) => notice.id !== id) }
      : current,
    { revalidate: false },
  );
}

/** After changing the family (a member's permissions, or a new kid): caches the updated family. */
export function afterFamilyChanged(mutate: ScopedMutator, response: FamilyResponse) {
  return mutate(FAMILY_API_KEY, response, { revalidate: false });
}

/** After creating or revoking an invite: reloads the pending invites. */
export function afterInvitesChanged(mutate: ScopedMutator) {
  return mutate(FAMILY_INVITES_API_KEY);
}

/** After removing a member: reloads the family, so the member disappears from the list. */
export function afterMemberRemoved(mutate: ScopedMutator) {
  return mutate(FAMILY_API_KEY);
}

/** After deleting the family: caches "no family" and reloads the account, whose membership is gone. */
export function afterFamilyDeleted(mutate: ScopedMutator) {
  return afterFamilyJoined(mutate, { family: null });
}
