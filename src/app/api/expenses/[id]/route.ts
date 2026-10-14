import { deleteExpenseForUser } from "@/lib/data/expenses";
import { json, parseId, withUser } from "@/lib/http/route";

export const DELETE = withUser(async (_request, user, context: RouteContext<"/api/expenses/[id]">) => {
  const id = parseId((await context.params).id, "Invalid expense identifier.");
  await deleteExpenseForUser(user.id, id);
  return json({ success: true });
}, { failure: "Unable to delete expense." });
