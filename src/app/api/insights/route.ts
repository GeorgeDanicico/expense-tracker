import type { NextRequest } from "next/server";

import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { loadInsights } from "@/lib/insights/load-insights";

export const GET = withPermission("expenses", "edit", async (request: NextRequest) => json(await loadInsights(request.nextUrl.searchParams)), {
  failure: "Unable to load spending insights.",
});
