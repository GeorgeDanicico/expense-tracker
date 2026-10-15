import { withPermission } from "@/lib/http/permission";
import { json, notFound, parseBody, parseId } from "@/lib/http/route";
import { updateNetWorthItem } from "@/lib/net-worth/service";
import { netWorthItemPatchSchema } from "@/lib/validation/net-worth";

export const PATCH = withPermission("net_worth", "edit", async (request, user, context: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context.params).id, "Invalid net-worth item identifier.");
  const input = await parseBody(request, netWorthItemPatchSchema, "Check the highlighted item changes and try again.");
  if (!(await updateNetWorthItem(user.id, id, input))) notFound("Net-worth item not found.");
  return json({ success: true });
}, { failure: "The net-worth item could not be updated." });
