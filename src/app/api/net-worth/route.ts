import { FAMILY_VIEWING, resolveFamilyViewers, resolveViewedUserFor, wantsFamilyView } from "@/lib/family/viewed-user";
import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { getFamilyNetWorthOverview, getNetWorthOverview } from "@/lib/net-worth/service";

export const GET = withPermission("net_worth", "edit", async (request, user, _context, member) => {
  if (wantsFamilyView(request)) {
    const viewers = await resolveFamilyViewers(member);
    return json({ ...(await getFamilyNetWorthOverview(viewers)), viewing: FAMILY_VIEWING });
  }
  const { userId, viewing } = await resolveViewedUserFor(request, user, member);
  return json({ ...(await getNetWorthOverview(userId)), viewing });
}, { failure: "Unable to load net worth." });
