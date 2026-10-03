import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expensesApiKey, mainExpensesApiKey, mainExpensesExportUrl } from "./keys";

describe("main Expenses request URLs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T22:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("normalizes future selections before making its API and export URLs", () => {
    expect(mainExpensesApiKey("2027-02")).toBe("/api/expenses?month=2027-01&context=main");
    expect(mainExpensesExportUrl("2027-02")).toBe("/api/expenses/export?month=2027-01");
    expect(mainExpensesApiKey("2026-12")).toBe("/api/expenses?month=2026-12&context=main");
  });

  it("preserves Home's separate monthly API contract", () => {
    expect(expensesApiKey("2027-02")).toBe("/api/expenses?month=2027-02");
  });
});
