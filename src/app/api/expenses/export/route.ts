import { NextResponse, type NextRequest } from "next/server";

import { buildExpenseWorkbook } from "@/lib/export/xlsx";
import { withPermission } from "@/lib/http/permission";
import { HttpError, PRIVATE_HEADERS } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { isValidMonth, resolveMainExpenseMonth } from "@/lib/calendar";

export const runtime = "nodejs";

// No `failure`: unexpected errors keep Next's default response instead of a JSON body.
export const GET = withPermission("expenses", "edit", async (request: NextRequest, user) => {
  const requestedMonth = request.nextUrl.searchParams.get("month") ?? "";
  if (!isValidMonth(requestedMonth)) {
    throw new HttpError(400, "Invalid month. Use YYYY-MM.");
  }
  const month = resolveMainExpenseMonth(requestedMonth);

  const repositories = getRepositories();
  const [expenses, currency] = await Promise.all([
    repositories.expenses.listMonth(user.id, month),
    repositories.account.getCurrency(user.id),
  ]);
  const workbook = buildExpenseWorkbook(expenses, currency);
  return new NextResponse(workbook, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="expenses-${month}.xlsx"`,
      ...PRIVATE_HEADERS,
      "X-Content-Type-Options": "nosniff",
      "X-Expense-Month": month,
    },
  });
});
