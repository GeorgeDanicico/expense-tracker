import type { NextRequest } from "next/server";

import { updateExpense } from "@/lib/expenses/service";
import { withPermission } from "@/lib/http/permission";
import { json, notFound, parseBody, parseId } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { expenseChangeSchema } from "@/lib/validation/expense";

const INVALID_ID = "Invalid expense identifier.";
const NOT_FOUND = "Expense not found.";

// Writes never read `?member=`: they always act on the caller's own expense.

/** Changes the fields the body names, as MCP's `update_expense` does: the same schema and use case (audit D10). */
export const PATCH = withPermission("expenses", "edit", async (request: NextRequest, user, context: RouteContext<"/api/expenses/[id]">) => {
  const id = parseId((await context.params).id, INVALID_ID);
  const patch = await parseBody(request, expenseChangeSchema, "Check the highlighted details and try again.");
  const expense = await updateExpense(user.id, id, patch);
  if (!expense) notFound(NOT_FOUND);
  return json({ expense });
}, { failure: "The expense could not be saved." });

/** 404 for an expense the caller doesn't own (or one already deleted), like MCP's `delete_expense` (audit B3). */
export const DELETE = withPermission("expenses", "edit", async (_request, user, context: RouteContext<"/api/expenses/[id]">) => {
  const id = parseId((await context.params).id, INVALID_ID);
  if (!(await getRepositories().expenses.delete(user.id, id))) notFound(NOT_FOUND);
  return json({ success: true });
}, { failure: "Unable to delete expense." });
