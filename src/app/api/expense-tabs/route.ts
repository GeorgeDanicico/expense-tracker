import { json, parseBody, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { expenseTabSchema } from "@/lib/validation/expense-tab";

export const GET = withUser(async (_request, user) => {
  return json({ tabs: await getRepositories().expenseTabs.list(user.id) });
}, { failure: "Unable to load expense tabs." });

export const POST = withUser(async (request, user) => {
  const input = await parseBody(request, expenseTabSchema, "Check the highlighted details and try again.");
  return json({ tab: await getRepositories().expenseTabs.create(user.id, input) }, 201);
}, { failure: "Unable to save expense tab." });
