import { withPermission } from "@/lib/http/permission";
import { json, notFound, parseBody, parseId } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { expenseTabSchema } from "@/lib/validation/expense-tab";

type TabRouteContext = { params: Promise<{ id: string }> };

export const PATCH = withPermission("expenses", "edit", async (request, user, context: TabRouteContext) => {
  const id = parseId((await context.params).id, "Invalid tab identifier.");
  const input = await parseBody(request, expenseTabSchema, "Check the highlighted details and try again.");
  const tab = await getRepositories().expenseTabs.update(user.id, id, input) ?? notFound("Expense tab not found.");
  return json({ tab });
}, { failure: "Unable to save expense tab." });

export const DELETE = withPermission("expenses", "edit", async (_request, user, context: TabRouteContext) => {
  const id = parseId((await context.params).id, "Invalid tab identifier.");
  if (!(await getRepositories().expenseTabs.delete(user.id, id))) notFound("Expense tab not found.");
  return json({ success: true });
}, { failure: "Unable to delete expense tab." });
