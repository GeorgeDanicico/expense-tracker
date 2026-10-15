import { json, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

export const DELETE = withUser(async (_request, user, context: RouteContext<"/api/expenses/[id]">) => {
  const id = parseId((await context.params).id, "Invalid expense identifier.");
  await getRepositories().expenses.delete(user.id, id);
  return json({ success: true });
}, { failure: "Unable to delete expense." });
