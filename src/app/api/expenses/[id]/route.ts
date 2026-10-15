import { withPermission } from "@/lib/http/permission";
import { json, parseId } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

export const DELETE = withPermission("expenses", "edit", async (_request, user, context: RouteContext<"/api/expenses/[id]">) => {
  const id = parseId((await context.params).id, "Invalid expense identifier.");
  await getRepositories().expenses.delete(user.id, id);
  return json({ success: true });
}, { failure: "Unable to delete expense." });
