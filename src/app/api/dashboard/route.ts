import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { getDashboardDataForUser } from "@/lib/data/expenses";
import { parseAnalyticsFilters } from "@/lib/utils/analytics";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  try {
    const filters = parseAnalyticsFilters(request.nextUrl.searchParams);
    const data = await getDashboardDataForUser(user.id, filters);
    return NextResponse.json(data, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Unable to load dashboard data." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
