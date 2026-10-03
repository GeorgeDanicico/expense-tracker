import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { getAccountCurrencyForUser } from "@/lib/data/account";
import { getMonthlyExpensesForUser } from "@/lib/data/expenses";
import { buildExpenseWorkbook } from "@/lib/export/xlsx";
import { isValidMonth, resolveMainExpenseMonth } from "@/lib/utils/dates";

export const runtime = "nodejs";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const requestedMonth = request.nextUrl.searchParams.get("month") ?? "";
  if (!isValidMonth(requestedMonth)) {
    return NextResponse.json({ error: "Invalid month. Use YYYY-MM." }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const month = resolveMainExpenseMonth(requestedMonth);

  const [expenses, currency] = await Promise.all([
    getMonthlyExpensesForUser(user.id, month),
    getAccountCurrencyForUser(user.id),
  ]);
  const workbook = buildExpenseWorkbook(expenses, currency);
  return new NextResponse(workbook, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="expenses-${month}.xlsx"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Expense-Month": month,
    },
  });
}
