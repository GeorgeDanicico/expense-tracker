import type { NextRequest } from "next/server";

import { loadDashboard } from "@/lib/expenses/load-dashboard";
import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";

export const GET = withPermission("expenses", "edit", async (request: NextRequest) => json(await loadDashboard(request.nextUrl.searchParams)), {
  failure: "Unable to load dashboard data.",
});
