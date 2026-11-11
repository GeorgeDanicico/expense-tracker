import type { NextRequest } from "next/server";

import { loadExpenseTabLedger } from "@/lib/expenses/load-expenses";
import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";

export const GET = withPermission("expenses", "edit", async (request: NextRequest, _user, context: RouteContext<"/api/expense-tabs/[id]/expenses">) =>
  json(await loadExpenseTabLedger((await context.params).id, request.nextUrl.searchParams)), { failure: "Unable to load expense tab." });
