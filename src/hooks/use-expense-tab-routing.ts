"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { MAIN_EXPENSE_TAB } from "@/components/expenses/expense-tabs";
import type { TabsResponse } from "@/lib/api/keys";
import { expenseTabHref, readExpenseTabFilters } from "@/lib/expenses/filters";
import type { ExpenseTab } from "@/lib/expenses/tabs";

/**
 * The expenses page's `?tab=` state. Redirects back to the main ledger when the
 * requested tab is not among the loaded tabs. All navigation keeps the other
 * query parameters and does not scroll.
 */
export function useExpenseTabRouting(tabsResult: TabsResponse | undefined) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const activeTabId = searchParams.get("tab") || null;
  const activeTab = activeTabId ?? MAIN_EXPENSE_TAB;

  useEffect(() => {
    if (!activeTabId || !tabsResult) return;
    if (tabsResult.tabs.some((tab) => tab.id === activeTabId)) return;
    router.replace(expenseTabHref(new URLSearchParams(queryString), null), { scroll: false });
  }, [activeTabId, queryString, router, tabsResult]);

  function changeTab(value: string) {
    const tabId = value === MAIN_EXPENSE_TAB ? null : value;
    router.push(expenseTabHref(new URLSearchParams(queryString), tabId), { scroll: false });
  }

  /** Opens a just-saved tab. An edited tab keeps the filters currently in the URL. */
  function saveTab(tab: ExpenseTab, { keepFilters }: { keepFilters: boolean }) {
    const params = new URLSearchParams(queryString);
    const filters = keepFilters ? readExpenseTabFilters(params) : undefined;
    router.push(expenseTabHref(params, tab.id, filters), { scroll: false });
  }

  function returnToMain() {
    router.push(expenseTabHref(new URLSearchParams(queryString), null), { scroll: false });
  }

  return { activeTabId, activeTab, changeTab, saveTab, returnToMain };
}
