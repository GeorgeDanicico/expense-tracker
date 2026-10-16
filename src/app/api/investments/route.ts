import { FAMILY_VIEWING, resolveFamilyViewers, resolveViewedUserFor, wantsFamilyView } from "@/lib/family/viewed-user";
import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { getFamilyInvestmentsOverview, getInvestmentsOverview } from "@/lib/investments/service";

export const GET = withPermission("investments", "edit", async (request, user, _context, member) => {
  if (wantsFamilyView(request)) {
    const viewers = await resolveFamilyViewers(member);
    return json({ ...(await getFamilyInvestmentsOverview(viewers)), viewing: FAMILY_VIEWING });
  }
  const { userId, viewing } = await resolveViewedUserFor(request, user, member);
  return json({ ...(await getInvestmentsOverview(userId)), viewing });
}, { failure: "Unable to load investments." });
