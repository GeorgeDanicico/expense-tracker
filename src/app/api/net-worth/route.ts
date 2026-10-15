import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { getNetWorthOverview } from "@/lib/net-worth/service";

export const GET = withPermission("net_worth", "edit", async (_request, user) => {
  return json(await getNetWorthOverview(user.id));
}, { failure: "Unable to load net worth." });
