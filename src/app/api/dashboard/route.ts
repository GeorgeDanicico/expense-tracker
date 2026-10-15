import type { NextRequest } from "next/server";

import { getDashboardData } from "@/lib/expenses/service";
import { json, withUser } from "@/lib/http/route";
import { parseAnalyticsFilters } from "@/lib/expenses/url-state";

export const GET = withUser(async (request: NextRequest, user) => {
  const filters = parseAnalyticsFilters(request.nextUrl.searchParams);
  return json(await getDashboardData(user.id, filters));
}, { failure: "Unable to load dashboard data." });
