import { createNetWorthItemForUser } from "@/lib/data/net-worth";
import { json, parseBody, withUser } from "@/lib/http/route";
import { netWorthItemSchema } from "@/lib/validation/net-worth";

export const POST = withUser(async (request, user) => {
  const input = await parseBody(request, netWorthItemSchema, "Check the highlighted item details and try again.");
  const result = await createNetWorthItemForUser(user.id, {
    ...input,
    purchaseAmount: input.purchaseAmount ?? null,
  });
  return json(result, 201);
}, { failure: "The net-worth item could not be saved." });
