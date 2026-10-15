import { json, withUser } from "@/lib/http/route";
import { getNetWorthOverview } from "@/lib/net-worth/service";

export const GET = withUser(async (_request, user) => {
  return json(await getNetWorthOverview(user.id));
}, { failure: "Unable to load net worth." });
