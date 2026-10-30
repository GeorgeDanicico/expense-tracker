import { describe, expect, it } from "vitest";

import { getAdminUserIds, getAiLimits, usdToMicros } from "@/lib/ai/config";

describe("getAiLimits", () => {
  it("defaults to $3 a family and $10 in all", () => {
    expect(getAiLimits({})).toEqual({ familyMonthlyMicros: 3_000_000, globalMonthlyMicros: 10_000_000 });
  });

  it("reads the two env values in dollars", () => {
    expect(getAiLimits({ AI_FAMILY_MONTHLY_USD: "5", AI_MONTHLY_BUDGET_USD: " 25.5 " })).toEqual({
      familyMonthlyMicros: 5_000_000,
      globalMonthlyMicros: 25_500_000,
    });
  });

  it("takes zero, which pauses AI", () => {
    expect(getAiLimits({ AI_FAMILY_MONTHLY_USD: "0" }).familyMonthlyMicros).toBe(0);
  });

  it.each(["", "  ", "abc", "-1", "NaN", "Infinity"])("falls back to the default for %j", (value) => {
    expect(getAiLimits({ AI_FAMILY_MONTHLY_USD: value, AI_MONTHLY_BUDGET_USD: value })).toEqual({
      familyMonthlyMicros: 3_000_000,
      globalMonthlyMicros: 10_000_000,
    });
  });

  it("rounds to whole micros", () => {
    expect(usdToMicros(0.0000004)).toBe(0);
    expect(usdToMicros(1.2345675)).toBe(1_234_568);
  });
});

describe("getAdminUserIds", () => {
  const first = "10000000-0000-4000-8000-0000000000ad";
  const second = "10000000-0000-4000-8000-0000000000ae";

  it("is empty when the variable isn't set", () => {
    expect(getAdminUserIds({})).toEqual([]);
  });

  it("splits a comma-separated list, trims and lowercases", () => {
    expect(getAdminUserIds({ APP_ADMIN_USER_IDS: ` ${first.toUpperCase()} , ${second}` })).toEqual([first, second]);
  });

  it("drops anything that isn't a user id, and repeats", () => {
    expect(getAdminUserIds({ APP_ADMIN_USER_IDS: `${first},george,${first},,${second}x` })).toEqual([first]);
  });
});
