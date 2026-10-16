import { resolveViewedUserFor } from "@/lib/family/viewed-user";
import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { getInvestmentsOverview } from "@/lib/investments/service";

export const GET = withPermission("investments", "edit", async (request, user, _context, member) => {
  const { userId, viewing } = await resolveViewedUserFor(request, user, member);
  return json({ ...(await getInvestmentsOverview(userId)), viewing });
}, { failure: "Unable to load investments." });
