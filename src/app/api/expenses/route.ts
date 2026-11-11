import type { NextRequest } from "next/server";

import { loadExpenses } from "@/lib/expenses/load-expenses";
import { createExpense } from "@/lib/expenses/service";
import { withPermission } from "@/lib/http/permission";
import { json, parseBody } from "@/lib/http/route";
import { expenseSchema } from "@/lib/validation/expense";

export const GET = withPermission("expenses", "edit", async (request: NextRequest) => json(await loadExpenses(request.nextUrl.searchParams)), {
  failure: "Unable to load expenses.",
});

// Writes never read `?member=`: they always act on the caller.

/** A new expense; its own date decides its month (audit D10), as in MCP's `add_expense`. */
export const POST = withPermission("expenses", "edit", async (request: NextRequest, user) => {
  const input = await parseBody(request, expenseSchema, "Check the highlighted details and try again.");
  return json({ expense: await createExpense(user.id, input) }, 201);
}, { failure: "The expense could not be saved." });
