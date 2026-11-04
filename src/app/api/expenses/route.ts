import type { NextRequest } from "next/server";

import { createExpense, getFamilyMonthlyLedger, getMonthlyLedger } from "@/lib/expenses/service";
import { FAMILY_VIEWING, resolveFamilyViewers, resolveViewedUserFor, wantsFamilyView } from "@/lib/family/viewed-user";
import { withPermission } from "@/lib/http/permission";
import { json, parseBody } from "@/lib/http/route";
import { getBucharestMonth, isValidMonth, resolveMainExpenseMonth } from "@/lib/calendar";
import { expenseSchema } from "@/lib/validation/expense";

export const GET = withPermission("expenses", "edit", async (request: NextRequest, user, _context, member) => {
  const family = wantsFamilyView(request) ? await resolveFamilyViewers(member) : null;
  const { userId, viewing } = family
    ? { userId: user.id, viewing: FAMILY_VIEWING }
    : await resolveViewedUserFor(request, user, member);
  const requestedMonth = request.nextUrl.searchParams.get("month") ?? "";
  const isMainLedger = request.nextUrl.searchParams.get("context") === "main";
  const month = isMainLedger
    ? resolveMainExpenseMonth(requestedMonth)
    : isValidMonth(requestedMonth) ? requestedMonth : getBucharestMonth();

  if (family) {
    return json({
      ...(await getFamilyMonthlyLedger(family, month)),
      ...(isMainLedger ? { effectiveMonth: month } : {}),
      viewing,
    });
  }

  const { expenses, total, average } = await getMonthlyLedger(userId, month);
  return json({
    month,
    ...(isMainLedger ? { effectiveMonth: month } : {}),
    expenses,
    total,
    average,
    viewing,
  });
}, { failure: "Unable to load expenses." });

// Writes never read `?member=`: they always act on the caller.

/** A new expense; its own date decides its month (audit D10), as in MCP's `add_expense`. */
export const POST = withPermission("expenses", "edit", async (request: NextRequest, user) => {
  const input = await parseBody(request, expenseSchema, "Check the highlighted details and try again.");
  return json({ expense: await createExpense(user.id, input) }, 201);
}, { failure: "The expense could not be saved." });
