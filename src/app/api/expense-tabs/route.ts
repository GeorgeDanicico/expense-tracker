import { resolveViewedUserFor } from "@/lib/family/viewed-user";
import { withPermission } from "@/lib/http/permission";
import { json, parseBody } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { expenseTabSchema } from "@/lib/validation/expense-tab";

export const GET = withPermission("expenses", "edit", async (request, user, _context, member) => {
  const { userId, viewing } = await resolveViewedUserFor(request, user, member);
  return json({ tabs: await getRepositories().expenseTabs.list(userId), viewing });
}, { failure: "Unable to load expense tabs." });

// Writes never read `?member=`: they always act on the caller.

export const POST = withPermission("expenses", "edit", async (request, user) => {
  const input = await parseBody(request, expenseTabSchema, "Check the highlighted details and try again.");
  return json({ tab: await getRepositories().expenseTabs.create(user.id, input) }, 201);
}, { failure: "Unable to save expense tab." });
