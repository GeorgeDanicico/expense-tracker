import { loadExpenseTabs } from "@/lib/expenses/load-expenses";
import { withPermission } from "@/lib/http/permission";
import { json, parseBody } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { expenseTabSchema } from "@/lib/validation/expense-tab";

export const GET = withPermission("expenses", "edit", async (request) => json(await loadExpenseTabs(new URL(request.url).searchParams)), {
  failure: "Unable to load expense tabs.",
});

// Writes never read `?member=`: they always act on the caller.

export const POST = withPermission("expenses", "edit", async (request, user) => {
  const input = await parseBody(request, expenseTabSchema, "Check the highlighted details and try again.");
  return json({ tab: await getRepositories().expenseTabs.create(user.id, input) }, 201);
}, { failure: "Unable to save expense tab." });
