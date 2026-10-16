import type { NextRequest } from "next/server";

import { getDashboardData } from "@/lib/expenses/service";
import { resolveViewedUserFor } from "@/lib/family/viewed-user";
import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { parseAnalyticsFilters } from "@/lib/expenses/url-state";

export const GET = withPermission("expenses", "edit", async (request: NextRequest, user, _context, member) => {
  const { userId, viewing } = await resolveViewedUserFor(request, user, member);
  const filters = parseAnalyticsFilters(request.nextUrl.searchParams);
  return json({ ...(await getDashboardData(userId, filters)), viewing });
}, { failure: "Unable to load dashboard data." });
