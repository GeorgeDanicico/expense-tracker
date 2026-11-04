import type { ScopedMutator } from "swr";

import { EXPENSE_TABS_API_KEY, IMPORTS_API_KEY, type TabsResponse } from "@/lib/api/keys";
import type { ExpenseTab, ExpenseTabLedgerData } from "@/lib/expenses/tabs";
import type { DashboardData, Expense, ExpensesData } from "@/lib/expenses/types";

// The SWR cache of everything that shows expenses, and how a write changes it (audit D6). Only the
// caller's own views are changed by hand; anything worked out on the server (a member's or the
// family's view, saved-tab ledgers, the dashboard's analytics, suggestions) is refetched instead.
// `useExpenseWrites` uses these; the import and reminder screens refetch with `afterExpenseLogged`.

/** The query of a cached key, when it is one of the caller's own reads at `path` (not a member's or the family's). */
function ownQuery(key: string, path: string) {
  if (!key.startsWith(`${path}?`)) return null;
  const params = new URLSearchParams(key.slice(path.length + 1));
  return params.has("member") ? null : params;
}

/** The month of a cached `/api/expenses?month=…` ledger of the caller's own, or null for any other key. */
export function ownLedgerMonth(key: string) {
  return ownQuery(key, "/api/expenses")?.get("month") ?? null;
}

const isOwnDashboardKey = (key: string) => ownQuery(key, "/api/dashboard") !== null;

/** A saved tab's ledger (`/api/expense-tabs/<id>/expenses?…`), anyone's. */
function isTabLedgerKey(key: string) {
  return key.startsWith(`${EXPENSE_TABS_API_KEY}/`) && key.includes("/expenses?");
}

const isOwnTabLedgerKey = (key: string) => isTabLedgerKey(key) && !new URLSearchParams(key.split("?")[1]).has("member");

/** What a write does to the expenses on show: `removed` goes, `added` comes (both, for an edit). */
export type ExpenseChange = { removed?: Expense; added?: Expense };

const monthOf = (expense: Expense | undefined) => expense?.expenseDate.slice(0, 7);
const sum = (expenses: readonly Expense[]) => expenses.reduce((total, expense) => total + expense.amount, 0);

/** Newest first by date, as the lists sort; a new expense goes before others of its day. */
function byDate(expenses: Expense[]) {
  return expenses.toSorted((a, b) => b.expenseDate.localeCompare(a.expenseDate));
}

/** `expenses` with `removed` taken out and `added` put in, or null when neither touches them. */
function changedList(expenses: Expense[], { removed, added }: ExpenseChange, month?: string) {
  const without = removed ? expenses.filter((expense) => expense.id !== removed.id) : expenses;
  const adds = added && (month === undefined || monthOf(added) === month);
  if (without.length === expenses.length && !adds) return null;
  return adds ? byDate([added, ...without]) : without;
}

function ledgerWith(ledger: ExpensesData, change: ExpenseChange): ExpensesData | null {
  const expenses = changedList(ledger.expenses, change, ledger.month);
  if (!expenses) return null;
  const total = sum(expenses);
  return { ...ledger, expenses, total, average: expenses.length ? total / expenses.length : 0 };
}

/** A tab ledger only loses rows by hand: which tab a new or changed expense belongs to is the server's to say. */
function tabLedgerWith(ledger: ExpenseTabLedgerData, { removed }: ExpenseChange): ExpenseTabLedgerData | null {
  const expenses = changedList(ledger.expenses, { removed });
  if (!expenses) return null;
  const total = sum(expenses);
  return { ...ledger, expenses, total, count: expenses.length, average: expenses.length ? total / expenses.length : 0 };
}

/** Home's month: the totals move by what left and came into the current month; the five newest are kept to five. */
function dashboardWith(dashboard: DashboardData, { removed, added }: ExpenseChange): DashboardData | null {
  const month = dashboard.currentMonth;
  const out = removed && monthOf(removed) === month ? removed : undefined;
  const into = added && monthOf(added) === month ? added : undefined;
  if (!out && !into) return null;
  const currentTotal = dashboard.currentTotal - (out?.amount ?? 0) + (into?.amount ?? 0);
  const currentCount = dashboard.currentCount - (out ? 1 : 0) + (into ? 1 : 0);
  return {
    ...dashboard,
    currentExpenses: (changedList(dashboard.currentExpenses, { removed: out, added: into }) ?? dashboard.currentExpenses).slice(0, 5),
    currentTotal,
    currentCount,
    currentAverage: currentCount ? currentTotal / currentCount : 0,
    currentLargest: Math.max(dashboard.currentLargest, into?.amount ?? 0),
  };
}

/**
 * The cached response at `key` after `change`, or `current` itself (the same object) when the key
 * isn't one of the caller's own views or the change doesn't touch it. Never a member's or the
 * family's view, whose totals are per member and per currency (audit B4): those are refetched.
 */
export function applyExpenseChange(key: string, current: unknown, change: ExpenseChange): unknown {
  if (!current || typeof current !== "object") return current;
  if (ownLedgerMonth(key) !== null && "month" in current && "expenses" in current) {
    return ledgerWith(current as ExpensesData, change) ?? current;
  }
  if (isOwnTabLedgerKey(key) && "tab" in current) return tabLedgerWith(current as ExpenseTabLedgerData, change) ?? current;
  if (isOwnDashboardKey(key) && "currentExpenses" in current) return dashboardWith(current as DashboardData, change) ?? current;
  return current;
}

const startsWith = (prefix: string) => (key: unknown) => typeof key === "string" && key.startsWith(prefix);

/**
 * Refetches what a write changes but the cache can't work out: every view that isn't the caller's
 * own month ledger (members', the family's: audit B4), the saved-tab ledgers, the dashboards
 * (analytics) and the description suggestions.
 */
export function refreshExpenseViews(mutate: ScopedMutator) {
  void mutate((key) => typeof key === "string" && key.startsWith("/api/expenses?") && ownLedgerMonth(key) === null);
  void mutate((key) => typeof key === "string" && isTabLedgerKey(key));
  void mutate(startsWith("/api/dashboard?"));
  void mutate(startsWith("/api/expenses/suggestions?"));
}

/** Refetches every cached ledger and derived view, after expenses added somewhere else (a reminder, an import). */
export function afterExpenseLogged(mutate: ScopedMutator) {
  void mutate(startsWith("/api/expenses?"));
  refreshExpenseViews(mutate);
}

/** After an import is confirmed or undone, which adds or removes many expenses at once: also the recent imports. */
export function afterImportChange(mutate: ScopedMutator) {
  afterExpenseLogged(mutate);
  void mutate(IMPORTS_API_KEY);
}

/** After a draft is uploaded or discarded, which changes the list of recent imports and no expense. */
export function afterImportDraftChange(mutate: ScopedMutator) {
  void mutate(IMPORTS_API_KEY);
}

/** The tab list with `saved` in place of the tab of its id, or added at the end. */
export function withTabSaved(current: TabsResponse | undefined, saved: ExpenseTab): TabsResponse {
  const existing = current?.tabs ?? [];
  return {
    tabs: existing.some((tab) => tab.id === saved.id)
      ? existing.map((tab) => (tab.id === saved.id ? saved : tab))
      : [...existing, saved],
  };
}

/** The tab list without the tab `id`. */
export function withoutTab(current: TabsResponse | undefined, id: string): TabsResponse | undefined {
  return current && { tabs: current.tabs.filter((tab) => tab.id !== id) };
}
