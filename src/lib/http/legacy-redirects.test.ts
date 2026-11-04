import { describe, expect, it } from "vitest";

import { INSIGHTS_PATH } from "@/lib/expenses/url-state";
import { legacyRedirects, LEGACY_DASHBOARD_PARAMS } from "@/lib/http/legacy-redirects";

describe("the old dashboard URLs", () => {
  const redirects = legacyRedirects();

  it("sends every old dashboard query to Insights, keeping the query", () => {
    expect(redirects.map((redirect) => redirect.has[0].key)).toEqual([...LEGACY_DASHBOARD_PARAMS]);
    for (const redirect of redirects) {
      expect(redirect.source).toBe("/dashboard");
      expect(redirect.destination).toBe(INSIGHTS_PATH);
      expect(redirect.has).toHaveLength(1);
      expect(redirect.permanent).toBe(false);
    }
  });

  it("covers every parameter the dashboards read", () => {
    // `dashboardView`, `dashboardMonth` and `parseAnalyticsFilters` read these, and `member` picks whose.
    expect(LEGACY_DASHBOARD_PARAMS).toEqual(expect.arrayContaining(["view", "month", "period", "granularity", "date", "member"]));
  });
});
