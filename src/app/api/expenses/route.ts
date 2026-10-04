import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { createExpenseForUser, getMonthlyExpensesForUser } from "@/lib/data/expenses";
import { summarizeExpenses } from "@/lib/expenses/summary";
import { getCurrentMonth, isValidMonth, resolveMainExpenseMonth } from "@/lib/utils/dates";
import { expenseSchema } from "@/lib/validation/expense";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const requestedMonth = request.nextUrl.searchParams.get("month") ?? "";
  const isMainLedger = request.nextUrl.searchParams.get("context") === "main";
  const month = isMainLedger
    ? resolveMainExpenseMonth(requestedMonth)
    : isValidMonth(requestedMonth) ? requestedMonth : getCurrentMonth();

  try {
    const expenses = await getMonthlyExpensesForUser(user.id, month);
    const { total, average } = summarizeExpenses(expenses);
    return NextResponse.json(
      {
        month,
        ...(isMainLedger ? { effectiveMonth: month } : {}),
        expenses,
        total,
        average,
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "Unable to load expenses." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const selectedMonth = typeof payload?.selectedMonth === "string" ? payload.selectedMonth : "";
  const parsed = expenseSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the highlighted details and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  }

  if (!isValidMonth(selectedMonth) || !parsed.data.expenseDate.startsWith(`${selectedMonth}-`)) {
    return NextResponse.json(
      {
        error: "Choose a date inside the selected month.",
        fieldErrors: { expenseDate: ["Date is outside the selected month."] },
      },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const expense = await createExpenseForUser(user.id, parsed.data);
    return NextResponse.json({ expense }, { status: 201, headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "The expense could not be saved." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
