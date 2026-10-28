import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/proxy", () => ({ updateSession: vi.fn() }));

import { config } from "@/proxy";

// Next compiles the matcher with path-to-regexp; as a plain regular expression over the whole path
// it means the same thing for this pattern.
const matcher = new RegExp(`^${config.matcher[0]}$`);
const runsOn = (path: string) => matcher.test(path);

describe("the proxy's matcher", () => {
  it("refreshes the session on pages and the signed-in API", () => {
    for (const path of ["/", "/calendar", "/dashboard", "/api/calendar/events", "/api/calendar/events/abc", "/api/account"]) {
      expect(runsOn(path), path).toBe(true);
    }
  });

  it("leaves out the calendar feed, which has no session to refresh", () => {
    const token = `sl_cal_${"A".repeat(43)}`;

    expect(runsOn(`/api/calendar/feed/${token}.ics`)).toBe(false);
    expect(runsOn(`/api/calendar/feed/${token}`)).toBe(false);
  });

  it("still covers the feed-link routes, which need the session", () => {
    expect(runsOn("/api/calendar/feed-link")).toBe(true);
    expect(runsOn("/api/calendar/feed-link/")).toBe(true);
    expect(runsOn("/api/calendar/feedback")).toBe(true);
  });

  it("keeps leaving out the MCP endpoint and health", () => {
    expect(runsOn("/api/mcp")).toBe(false);
    expect(runsOn("/health")).toBe(false);
  });
});
