import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPENSE_TAB_FILTERS } from "@/lib/expenses/filters";

import {
  dashboardApiKey,
  expenseTabExpensesApiKey,
  expenseTabsApiKey,
  expensesApiKey,
  investmentsApiKey,
  investmentTransactionsApiKey,
  mainExpensesApiKey,
  mainExpensesExportUrl,
  netWorthApiKey,
  withMember,
} from "./keys";

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

describe("keys for another member's data", () => {
  const member = "60000000-0000-4000-8000-000000000002";

  it("leaves your own keys exactly as they were", () => {
    expect(withMember("/api/net-worth", null)).toBe("/api/net-worth");
    expect(withMember("/api/net-worth", undefined)).toBe("/api/net-worth");
    expect(investmentsApiKey()).toBe("/api/investments");
    expect(expenseTabsApiKey(null)).toBe("/api/expense-tabs");
  });

  it("adds the member to a key without a query", () => {
    expect(netWorthApiKey(member)).toBe(`/api/net-worth?member=${member}`);
    expect(investmentsApiKey(member)).toBe(`/api/investments?member=${member}`);
    expect(expenseTabsApiKey(member)).toBe(`/api/expense-tabs?member=${member}`);
  });

  it("adds the member after an existing query", () => {
    expect(expensesApiKey("2026-10", member)).toBe(`/api/expenses?month=2026-10&member=${member}`);
    expect(mainExpensesApiKey("2026-10", member)).toBe(`/api/expenses?month=2026-10&member=${member}&context=main`);
    expect(mainExpensesExportUrl("2026-10", member)).toBe(`/api/expenses/export?month=2026-10&member=${member}`);
    expect(dashboardApiKey({ period: "3m", granularity: "month", customDate: "2026-10" }, member)).toContain(`&member=${member}`);
    expect(expenseTabExpensesApiKey("t1", DEFAULT_EXPENSE_TAB_FILTERS, "rev", member)).toMatch(
      new RegExp(`^/api/expense-tabs/t1/expenses\\?.*revision=rev.*&member=${member}$`),
    );
    expect(
      investmentTransactionsApiKey({ accountId: "a", instrument: "VWCE", currency: "EUR", member }),
    ).toMatch(new RegExp(`&member=${member}$`));
  });

  it("gives different members different keys", () => {
    expect(netWorthApiKey(member)).not.toBe(netWorthApiKey("60000000-0000-4000-8000-000000000003"));
    expect(netWorthApiKey(member)).not.toBe(netWorthApiKey());
  });
});
