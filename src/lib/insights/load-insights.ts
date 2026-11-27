import "server-only";

import { getBucharestMonth, getBucharestToday, isValidMonth } from "@/lib/calendar";
import { expensesCaller } from "@/lib/expenses/load-expenses";
import { ALL_MEMBERS, MEMBER_PARAM, resolveViewedUser } from "@/lib/family/viewed-user";
import { HttpError } from "@/lib/http/route";
import { getSpendingInsights } from "@/lib/insights/service";

/**
 * `GET /api/insights`'s answer for `query` (its search params): the spending changes and recurring
 * payments of `?month=` (the current month when missing or invalid) for the caller, or for a member
 * (`?member=<id>`, read-only), after the same checks as the expense reads. Not for the whole family
 * (`?member=all`): members can keep different currencies, and their spending is never added up.
 */
export async function loadInsights(query: URLSearchParams) {
  const { user, member } = await expensesCaller();
  const memberParam = query.get(MEMBER_PARAM);
  if (memberParam === ALL_MEMBERS) throw new HttpError(400, "Choose one family member to see their spending insights.");
  const { userId, viewing } = await resolveViewedUser(memberParam, user, member);
  const requested = query.get("month") ?? "";
  const month = isValidMonth(requested) ? requested : getBucharestMonth();
  return { ...(await getSpendingInsights(userId, month, getBucharestToday())), viewing };
}

/** `GET /api/insights`'s response. */
export type InsightsData = Awaited<ReturnType<typeof loadInsights>>;
