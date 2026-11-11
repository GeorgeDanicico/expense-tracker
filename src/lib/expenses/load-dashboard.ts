import "server-only";

import { getAuthenticatedUser } from "@/lib/auth";
import { getDashboardData, getFamilyDashboardData } from "@/lib/expenses/service";
import { parseAnalyticsFilters } from "@/lib/expenses/url-state";
import { ALL_MEMBERS, FAMILY_VIEWING, MEMBER_PARAM, resolveFamilyViewers, resolveViewedUser } from "@/lib/family/viewed-user";
import { FORBIDDEN_MESSAGE, requirePermission } from "@/lib/http/permission";
import { HttpError } from "@/lib/http/route";

/**
 * `GET /api/dashboard`'s answer for `query` (its search params): the caller's own analytics, a
 * member's, or the family's (`?member=all`), after the same checks, the `expenses` permission
 * included (a 403 otherwise). The route and Home's server render both call it (PF6). The user and the
 * membership come from the request's memo, so the route's own check costs no second read.
 */
export async function loadDashboard(query: URLSearchParams) {
  const [user, member] = await Promise.all([getAuthenticatedUser(), requirePermission("expenses", "edit")]);
  // Not reached: the route and the page only call it with a session.
  if (!user) throw new HttpError(403, FORBIDDEN_MESSAGE);
  const filters = parseAnalyticsFilters(query);
  const memberParam = query.get(MEMBER_PARAM);
  if (memberParam === ALL_MEMBERS) {
    const viewers = await resolveFamilyViewers(member);
    return { ...(await getFamilyDashboardData(viewers, filters)), viewing: FAMILY_VIEWING };
  }
  const { userId, viewing } = await resolveViewedUser(memberParam, user, member);
  return { ...(await getDashboardData(userId, filters)), viewing };
}
