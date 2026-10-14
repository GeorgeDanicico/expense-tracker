import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dashboardHref,
  dashboardMonth,
  dashboardView,
  parseAnalyticsFilters,
} from "@/lib/expenses/url-state";
import { dashboardApiKey } from "@/lib/api/keys";

describe("Home URL state", () => {
  it("defaults missing and invalid views to Summary", () => {
    expect(dashboardView(new URLSearchParams())).toBe("summary");
    expect(dashboardView(new URLSearchParams("view=invalid&period=6m"))).toBe(
      "summary",
    );
  });
  it("keeps existing analytics links opening History", () => {
    for (const query of ["period=6m", "date=2026-08", "granularity=day"])
      expect(dashboardView(new URLSearchParams(query))).toBe("history");
    expect(dashboardView(new URLSearchParams("month=2026-08"))).toBe("summary");
    expect(dashboardView(new URLSearchParams("view=monthly&period=6m"))).toBe(
      "monthly",
    );
  });
  it("validates Monthly defaults", () => {
    expect(dashboardMonth(new URLSearchParams(), "2026-10")).toBe("2026-10");
    expect(
      dashboardMonth(new URLSearchParams("month=2026-13"), "2026-10"),
    ).toBe("2026-10");
    expect(
      dashboardMonth(new URLSearchParams("month=2024-02"), "2026-10"),
    ).toBe("2024-02");
  });
  it("preserves every view's parameters while switching tabs", () => {
    const initial = new URLSearchParams(
      "view=history&period=custom&granularity=day&date=2026-08-17&month=2026-07",
    );
    const url = dashboardHref(initial, { view: "monthly" });
    const updated = new URL(url, "http://localhost").searchParams;
    expect(updated.get("month")).toBe("2026-07");
    expect(updated.get("date")).toBe("2026-08-17");
    expect(dashboardView(updated)).toBe("monthly");
    expect(initial.get("view")).toBe("history");
  });
  it("excludes view and Monthly parameters from dashboard API keys", () => {
    const params = new URLSearchParams(
      "period=custom&granularity=day&date=2026-08-17&view=history&month=2026-07",
    );
    expect(dashboardApiKey(parseAnalyticsFilters(params))).toBe(
      "/api/dashboard?period=custom&granularity=day&date=2026-08-17",
    );
  });
});

describe("Home URL state defaults on the Bucharest calendar", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to the Bucharest month and day while UTC is still in the previous one", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T22:30:00Z"));
    expect(dashboardMonth(new URLSearchParams())).toBe("2026-11");
    expect(parseAnalyticsFilters(new URLSearchParams("period=custom&date=bad")).customDate).toBe("2026-11");
    expect(
      parseAnalyticsFilters(new URLSearchParams("period=custom&granularity=day")).customDate,
    ).toBe("2026-11-01");
  });

  it("stays on New Year's Eve until midnight in Bucharest", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T21:59:59Z"));
    expect(dashboardMonth(new URLSearchParams())).toBe("2026-12");
    expect(
      parseAnalyticsFilters(new URLSearchParams("period=custom&granularity=day")).customDate,
    ).toBe("2026-12-31");
  });
});
