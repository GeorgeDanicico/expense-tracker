import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { getAccountCurrency } from "@/lib/data/account";
import { getMonthlyExpenses } from "@/lib/data/expenses";
import { buildExpenseWorkbook } from "@/lib/export/xlsx";
import { isValidMonth } from "@/lib/utils/dates";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!isValidMonth(month)) {
    return NextResponse.json({ error: "Invalid month. Use YYYY-MM." }, { status: 400 });
  }

  const [expenses, currency] = await Promise.all([
    getMonthlyExpenses(month),
    getAccountCurrency(),
  ]);
  const workbook = buildExpenseWorkbook(expenses, currency);
  return new NextResponse(workbook, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="expenses-${month}.xlsx"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
