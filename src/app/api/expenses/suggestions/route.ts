import type { NextRequest } from "next/server";

import { suggestExpenses, SUGGESTION_SCAN_ROWS } from "@/lib/expenses/suggestions";
import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

/**
 * The expense form's suggestions for `?q=` and its category guess, from the caller's own newest
 * expenses (never a member's: no `?member=`). Same permission as adding an expense.
 */
export const GET = withPermission("expenses", "edit", async (request: NextRequest, user) => {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const rows = await getRepositories().expenses.recentDescriptions(user.id, SUGGESTION_SCAN_ROWS);
  return json(suggestExpenses(rows, query));
}, { failure: "Unable to load suggestions." });
