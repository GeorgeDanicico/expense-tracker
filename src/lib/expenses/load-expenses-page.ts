import "server-only";

import { loadPageAccount } from "@/lib/account/load-account";
import { expenseTabExpensesApiKey, expenseTabsApiKey, FAMILY_API_KEY, mainExpensesApiKey, type TabsResponse } from "@/lib/api/keys";
import type { ServerFallbackData } from "@/lib/api/server-fallback";
import { resolveMainExpenseMonth, shiftMonth } from "@/lib/calendar";
import { loadExpenses, loadExpenseTabLedger, loadExpenseTabs } from "@/lib/expenses/load-expenses";
import { readExpenseTabFilters } from "@/lib/expenses/filters";
import { loadFamily } from "@/lib/family/load-family";
import { ALL_MEMBERS, MEMBER_PARAM } from "@/lib/family/viewing";
import { can } from "@/lib/permissions";
import { prefetch } from "@/lib/server-prefetch";

const EXPENSES_PATH = "/expenses";

/** A page's `searchParams` as the URL's query. */
function toSearchParams(searchParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(name, value);
    else if (value) params.set(name, value[0] ?? "");
  }
  return params;
}

/**
 * The Expenses page's first data, started on the server (PF7; the pattern is in
 * src/lib/server-prefetch.ts), for the URL the browser will draw: the month in `?month=`, the viewed
 * member in `?member=` and the open saved tab in `?tab=`, read the way the page reads them
 * (src/lib/expenses/url-state.ts, `useViewing`, `useExpenseTabRouting`), with the keys built by the
 * same functions.
 *
 * - **Nothing** without a session or the `expenses` permission (the page shows its message), and
 *   nothing for another member's data to someone who may not view it: no member key reaches the HTML.
 * - **The main ledger** (no tab): the month and the month before it (for "change from last month"),
 *   and, apart from the family view, the saved tabs the chips show.
 * - **The family list**, for anyone in a family: the member picker and the member colours read it, and
 *   the page waits for it to know another member's name and currency.
 * - **A saved tab** (`?tab=`): the tabs, then, when that tab exists, its ledger for the filters in the
 *   URL. The key carries the tab's `updatedAt`, so the tabs are awaited here before the page renders.
 */
export async function loadExpensesFallback(searchParams: Record<string, string | string[] | undefined>): Promise<ServerFallbackData> {
  const account = await loadPageAccount();
  if (!account || !can(account.membership, "expenses", "edit")) return {};

  const params = toSearchParams(searchParams);
  const requested = params.get(MEMBER_PARAM) || null;
  const family = requested === ALL_MEMBERS;
  // As `useViewing`: yourself is no member, "all" is the family view.
  const member = requested && requested.toLowerCase() !== account.membership?.memberId.toLowerCase() ? requested : null;
  if (member && !can(account.membership, "family_finance", "view")) return {};

  const fallback: ServerFallbackData = {};
  if (account.membership) fallback[FAMILY_API_KEY] = prefetch(EXPENSES_PATH, FAMILY_API_KEY, loadFamily);
  const tabId = params.get("tab") || null;
  const tabsKey = expenseTabsApiKey(member);
  const tabs = family ? null : prefetch(EXPENSES_PATH, tabsKey, loadExpenseTabs);
  if (tabs) fallback[tabsKey] = tabs;

  if (!tabId) {
    const month = resolveMainExpenseMonth(params.get("month"));
    const key = mainExpensesApiKey(month, member);
    fallback[key] = prefetch(EXPENSES_PATH, key, loadExpenses);
    if (!family) {
      const previous = mainExpensesApiKey(shiftMonth(month, -1), member);
      fallback[previous] = prefetch(EXPENSES_PATH, previous, loadExpenses);
    }
    return fallback;
  }

  const tab = (await tabs as TabsResponse | undefined)?.tabs.find((entry) => entry.id === tabId);
  if (tab) {
    const key = expenseTabExpensesApiKey(tab.id, readExpenseTabFilters(params), tab.updatedAt, member);
    fallback[key] = prefetch(EXPENSES_PATH, key, (query) => loadExpenseTabLedger(tab.id, query));
  }
  return fallback;
}
