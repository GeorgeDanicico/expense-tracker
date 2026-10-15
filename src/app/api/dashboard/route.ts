import type { NextRequest } from "next/server";

import { getDashboardData } from "@/lib/expenses/service";
import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { parseAnalyticsFilters } from "@/lib/expenses/url-state";

export const GET = withPermission("expenses", "edit", async (request: NextRequest, user) => {
  const filters = parseAnalyticsFilters(request.nextUrl.searchParams);
  return json(await getDashboardData(user.id, filters));
}, { failure: "Unable to load dashboard data." });
