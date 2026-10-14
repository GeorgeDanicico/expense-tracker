import { getInvestmentsOverviewForUser } from "@/lib/data/investments";
import { json, withUser } from "@/lib/http/route";

export const GET = withUser(async (_request, user) => {
  return json(await getInvestmentsOverviewForUser(user.id));
}, { failure: "Unable to load investments." });
