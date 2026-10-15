import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { getInvestmentsOverview } from "@/lib/investments/service";

export const GET = withPermission("investments", "edit", async (_request, user) => {
  return json(await getInvestmentsOverview(user.id));
}, { failure: "Unable to load investments." });
