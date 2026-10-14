import type { NextRequest } from "next/server";

import { getExpenseTabForUser } from "@/lib/data/expense-tabs";
import { getExpenseTabExpensesForUser } from "@/lib/data/expenses";
import { summarizeExpenses } from "@/lib/expenses/summary";
import type { ExpenseTabLedgerData } from "@/lib/expenses/tabs";
import { parseExpenseTabFilters } from "@/lib/frontend/expense-tab-state";
import { HttpError, json, notFound, parseId, withUser } from "@/lib/http/route";

type TabRouteContext = { params: Promise<{ id: string }> };

export const GET = withUser(async (request: NextRequest, user, context: TabRouteContext) => {
  const id = parseId((await context.params).id, "Invalid tab identifier.");
  const parsed = parseExpenseTabFilters(request.nextUrl.searchParams);
  if (!parsed.success) {
    throw new HttpError(422, "Check the expense filters and try again.", parsed.error.flatten().fieldErrors);
  }
  const tab = await getExpenseTabForUser(user.id, id) ?? notFound("Expense tab not found.");
  const expenses = await getExpenseTabExpensesForUser(user.id, tab, parsed.data);
  const { total, count, average } = summarizeExpenses(expenses);
  const response: ExpenseTabLedgerData = {
    tab, tabId: tab.id, tabRevision: tab.updatedAt, filters: parsed.data, expenses,
    total, count, average,
  };
  return json(response);
}, { failure: "Unable to load expense tab." });
