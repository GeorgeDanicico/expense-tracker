import { deleteExpenseTabForUser, updateExpenseTabForUser } from "@/lib/data/expense-tabs";
import { json, notFound, parseBody, parseId, withUser } from "@/lib/http/route";
import { expenseTabSchema } from "@/lib/validation/expense-tab";

type TabRouteContext = { params: Promise<{ id: string }> };

export const PATCH = withUser(async (request, user, context: TabRouteContext) => {
  const id = parseId((await context.params).id, "Invalid tab identifier.");
  const input = await parseBody(request, expenseTabSchema, "Check the highlighted details and try again.");
  const tab = await updateExpenseTabForUser(user.id, id, input) ?? notFound("Expense tab not found.");
  return json({ tab });
}, { failure: "Unable to save expense tab." });

export const DELETE = withUser(async (_request, user, context: TabRouteContext) => {
  const id = parseId((await context.params).id, "Invalid tab identifier.");
  if (!(await deleteExpenseTabForUser(user.id, id))) notFound("Expense tab not found.");
  return json({ success: true });
}, { failure: "Unable to delete expense tab." });
