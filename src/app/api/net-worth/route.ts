import { resolveViewedUserFor } from "@/lib/family/viewed-user";
import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { getNetWorthOverview } from "@/lib/net-worth/service";

export const GET = withPermission("net_worth", "edit", async (request, user, _context, member) => {
  const { userId, viewing } = await resolveViewedUserFor(request, user, member);
  return json({ ...(await getNetWorthOverview(userId)), viewing });
}, { failure: "Unable to load net worth." });
