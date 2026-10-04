import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { getExpenseTabForUser } from "@/lib/data/expense-tabs";
import { getExpenseTabExpensesForUser } from "@/lib/data/expenses";
import { summarizeExpenses } from "@/lib/expenses/summary";
import type { ExpenseTabLedgerData } from "@/lib/expenses/tabs";
import { parseExpenseTabFilters } from "@/lib/frontend/expense-tab-state";
import { expenseTabIdSchema } from "@/lib/validation/expense-tab";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
type TabRouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: TabRouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  const { id } = await context.params;
  if (!expenseTabIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid tab identifier." }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const parsed = parseExpenseTabFilters(request.nextUrl.searchParams);
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the expense filters and try again.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422, headers: PRIVATE_HEADERS });
  }
  try {
    const tab = await getExpenseTabForUser(user.id, id);
    if (!tab) return NextResponse.json({ error: "Expense tab not found." }, { status: 404, headers: PRIVATE_HEADERS });
    const expenses = await getExpenseTabExpensesForUser(user.id, tab, parsed.data);
    const { total, count, average } = summarizeExpenses(expenses);
    const response: ExpenseTabLedgerData = {
      tab, tabId: tab.id, tabRevision: tab.updatedAt, filters: parsed.data, expenses,
      total, count, average,
    };
    return NextResponse.json(response, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Unable to load expense tab." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
