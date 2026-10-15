import { json, withUser } from "@/lib/http/route";
import { getInvestmentsOverview } from "@/lib/investments/service";

export const GET = withUser(async (_request, user) => {
  return json(await getInvestmentsOverview(user.id));
}, { failure: "Unable to load investments." });
