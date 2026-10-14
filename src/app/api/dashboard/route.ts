import type { NextRequest } from "next/server";

import { getDashboardDataForUser } from "@/lib/data/expenses";
import { json, withUser } from "@/lib/http/route";
import { parseAnalyticsFilters } from "@/lib/expenses/url-state";

export const GET = withUser(async (request: NextRequest, user) => {
  const filters = parseAnalyticsFilters(request.nextUrl.searchParams);
  return json(await getDashboardDataForUser(user.id, filters));
}, { failure: "Unable to load dashboard data." });
