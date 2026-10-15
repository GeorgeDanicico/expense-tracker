import { json, notFound, parseBody, parseId, withUser } from "@/lib/http/route";
import { addNetWorthValuation } from "@/lib/net-worth/service";
import { netWorthValuationSchema } from "@/lib/validation/net-worth";

export const POST = withUser(async (request, user, context: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context.params).id, "Invalid net-worth item identifier.");
  const input = await parseBody(request, netWorthValuationSchema, "Check the highlighted valuation and try again.");
  const valuation = await addNetWorthValuation(user.id, id, input) ?? notFound("Net-worth item not found.");
  return json({ valuation }, 201);
}, { failure: "The valuation could not be saved." });
