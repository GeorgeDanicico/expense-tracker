import { createExpenseTabForUser, getExpenseTabsForUser } from "@/lib/data/expense-tabs";
import { json, parseBody, withUser } from "@/lib/http/route";
import { expenseTabSchema } from "@/lib/validation/expense-tab";

export const GET = withUser(async (_request, user) => {
  return json({ tabs: await getExpenseTabsForUser(user.id) });
}, { failure: "Unable to load expense tabs." });

export const POST = withUser(async (request, user) => {
  const input = await parseBody(request, expenseTabSchema, "Check the highlighted details and try again.");
  return json({ tab: await createExpenseTabForUser(user.id, input) }, 201);
}, { failure: "Unable to save expense tab." });
