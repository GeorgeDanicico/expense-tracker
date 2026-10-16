import type { NextRequest } from "next/server";

import type { ExpenseTabLedgerData } from "@/lib/expenses/tabs";
import { parseExpenseTabFilters } from "@/lib/expenses/filters";
import { getExpenseTabLedger } from "@/lib/expenses/service";
import { resolveViewedUserFor } from "@/lib/family/viewed-user";
import { withPermission } from "@/lib/http/permission";
import { HttpError, json, notFound, parseId } from "@/lib/http/route";

type TabRouteContext = { params: Promise<{ id: string }> };

export const GET = withPermission("expenses", "edit", async (request: NextRequest, user, context: TabRouteContext, member) => {
  const { userId, viewing } = await resolveViewedUserFor(request, user, member);
  const id = parseId((await context.params).id, "Invalid tab identifier.");
  const parsed = parseExpenseTabFilters(request.nextUrl.searchParams);
  if (!parsed.success) {
    throw new HttpError(422, "Check the expense filters and try again.", parsed.error.flatten().fieldErrors);
  }
  const ledger: ExpenseTabLedgerData =
    await getExpenseTabLedger(userId, id, parsed.data) ?? notFound("Expense tab not found.");
  return json({ ...ledger, viewing });
}, { failure: "Unable to load expense tab." });
