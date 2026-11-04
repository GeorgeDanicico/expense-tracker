import { describe, expect, it } from "vitest";

import { monthChange } from "@/lib/expenses/month-change";

const spent = (...entries: [string, number][]) => entries.map(([expenseDate, amount]) => ({ expenseDate, amount }));

describe("monthChange", () => {
  it("compares the current month with the same days of the month before", () => {
    // October up to the 4th: 100; November so far: 82.
    const october = spent(["2026-10-02", 60], ["2026-10-04", 40], ["2026-10-20", 500]);
    expect(monthChange("2026-11", spent(["2026-11-03", 82]), october, "2026-11-04")).toBe("18% less than October so far");
  });

  it("compares a past month with the whole month before", () => {
    expect(monthChange("2026-10", spent(["2026-10-01", 112]), spent(["2026-09-30", 100]), "2026-11-04")).toBe("12% more than September");
    expect(monthChange("2026-10", spent(["2026-10-01", 100]), spent(["2026-09-30", 100]), "2026-11-04")).toBe("the same as September");
  });

  it("counts all of a shorter month before when today is past its end", () => {
    expect(monthChange("2026-03", spent(["2026-03-01", 50]), spent(["2026-02-28", 100]), "2026-03-31")).toBe("50% less than February so far");
  });

  it("says nothing when the month before has nothing to compare with", () => {
    expect(monthChange("2026-11", spent(["2026-11-01", 10]), [], "2026-11-04")).toBeNull();
    expect(monthChange("2026-11", spent(["2026-11-01", 10]), spent(["2026-10-20", 10]), "2026-11-04")).toBeNull();
  });
});
