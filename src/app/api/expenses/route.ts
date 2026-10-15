import type { NextRequest } from "next/server";

import { getMonthlyLedger } from "@/lib/expenses/service";
import { HttpError, json, parseInput, readJson, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { getBucharestMonth, isValidMonth, resolveMainExpenseMonth } from "@/lib/calendar";
import { expenseSchema } from "@/lib/validation/expense";

export const GET = withUser(async (request: NextRequest, user) => {
  const requestedMonth = request.nextUrl.searchParams.get("month") ?? "";
  const isMainLedger = request.nextUrl.searchParams.get("context") === "main";
  const month = isMainLedger
    ? resolveMainExpenseMonth(requestedMonth)
    : isValidMonth(requestedMonth) ? requestedMonth : getBucharestMonth();

  const { expenses, total, average } = await getMonthlyLedger(user.id, month);
  return json({
    month,
    ...(isMainLedger ? { effectiveMonth: month } : {}),
    expenses,
    total,
    average,
  });
}, { failure: "Unable to load expenses." });

export const POST = withUser(async (request: NextRequest, user) => {
  const payload = (await readJson(request)) as Record<string, unknown> | null;
  const selectedMonth = typeof payload?.selectedMonth === "string" ? payload.selectedMonth : "";
  const input = parseInput(payload, expenseSchema, "Check the highlighted details and try again.");

  if (!isValidMonth(selectedMonth) || !input.expenseDate.startsWith(`${selectedMonth}-`)) {
    throw new HttpError(422, "Choose a date inside the selected month.", {
      expenseDate: ["Date is outside the selected month."],
    });
  }

  return json({ expense: await getRepositories().expenses.create(user.id, input) }, 201);
}, { failure: "The expense could not be saved." });
