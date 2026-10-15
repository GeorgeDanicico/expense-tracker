import { withPermission } from "@/lib/http/permission";
import { json, parseBody } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { netWorthItemSchema } from "@/lib/validation/net-worth";

export const POST = withPermission("net_worth", "edit", async (request, user) => {
  const input = await parseBody(request, netWorthItemSchema, "Check the highlighted item details and try again.");
  const result = await getRepositories().netWorth.createItem(user.id, {
    ...input,
    purchaseAmount: input.purchaseAmount ?? null,
  });
  return json(result, 201);
}, { failure: "The net-worth item could not be saved." });
