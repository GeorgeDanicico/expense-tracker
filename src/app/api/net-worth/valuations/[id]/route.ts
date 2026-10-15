import { json, notFound, parseBody, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { netWorthValuationSchema } from "@/lib/validation/net-worth";

export const PATCH = withUser(async (request, user, context: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context.params).id, "Invalid valuation identifier.");
  const input = await parseBody(request, netWorthValuationSchema, "Check the highlighted valuation and try again.");
  const valuation = await getRepositories().netWorth.updateValuation(user.id, id, input) ?? notFound("Valuation not found.");
  return json({ valuation });
}, { failure: "The valuation could not be corrected." });
