import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { getMonthlyExpensesForUser } from "@/lib/data/expenses";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMonth, isValidMonth } from "@/lib/utils/dates";
import { expenseSchema } from "@/lib/validation/expense";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const requestedMonth = request.nextUrl.searchParams.get("month") ?? "";
  const month = isValidMonth(requestedMonth) ? requestedMonth : getCurrentMonth();

  try {
    const expenses = await getMonthlyExpensesForUser(user.id, month);
    const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    return NextResponse.json(
      {
        month,
        expenses,
        total,
        average: expenses.length ? total / expenses.length : 0,
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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      user_id: user.id,
      description: parsed.data.description,
      amount: parsed.data.amount,
      category: parsed.data.category,
      expense_date: parsed.data.expenseDate,
      notes: parsed.data.notes || null,
    })
    .select("id, description, amount, category, expense_date, notes")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "The expense could not be saved." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      expense: {
        id: data.id,
        description: data.description,
        amount: Number(data.amount),
        category: data.category,
        expenseDate: data.expense_date,
        notes: data.notes,
      },
    },
    { status: 201, headers: PRIVATE_HEADERS },
  );
}
