import { withPermission } from "@/lib/http/permission";
import { noContent, notFound, parseId } from "@/lib/http/route";
import { deleteInvestmentTransaction } from "@/lib/investments/service";

export const DELETE = withPermission("investments", "edit", async (_request, user, context: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context.params).id, "Invalid investment order identifier.");
  if (!(await deleteInvestmentTransaction(user.id, id))) notFound("Investment order not found.");
  return noContent();
}, { failure: "Unable to remove investment order." });
