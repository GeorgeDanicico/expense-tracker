import { getNetWorthOverviewForUser } from "@/lib/data/net-worth";
import { json, withUser } from "@/lib/http/route";

export const GET = withUser(async (_request, user) => {
  return json(await getNetWorthOverviewForUser(user.id));
}, { failure: "Unable to load net worth." });
