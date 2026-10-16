import { describe, expect, it } from "vitest";

import { compareFamilyExpenses, groupByCurrency } from "./family";

const row = (currency: string, total: number, count = 1, largest = total) => ({ currency, total, count, largest });

describe("groupByCurrency", () => {
  it("adds figures of the same currency and keeps different currencies apart", () => {
    expect(groupByCurrency([row("RON", 1000, 4, 600), row("EUR", 85), row("RON", 240, 2, 200)])).toEqual([
      { currency: "RON", total: 1240, count: 6, average: 1240 / 6, largest: 600 },
      { currency: "EUR", total: 85, count: 1, average: 85, largest: 85 },
    ]);
  });

  it("puts the biggest total first, then orders equal totals by currency code", () => {
    const order = (entries: ReturnType<typeof row>[]) => groupByCurrency(entries).map((entry) => entry.currency);

    expect(order([row("EUR", 5), row("USD", 50), row("RON", 5)])).toEqual(["USD", "EUR", "RON"]);
  });

  it("adds decimals exactly", () => {
    expect(groupByCurrency([row("EUR", 0.1), row("EUR", 0.2)])[0].total).toBe(0.3);
  });

  it("reports a zero average and no entries for nothing", () => {
    expect(groupByCurrency([])).toEqual([]);
    expect(groupByCurrency([row("EUR", 0, 0, 0)])).toEqual([{ currency: "EUR", total: 0, count: 0, average: 0, largest: 0 }]);
  });
});

describe("compareFamilyExpenses", () => {
  it("orders newest first, then by member name, then by id", () => {
    const rows = [
      { expenseDate: "2026-09-01", memberName: "Ana", id: "b" },
      { expenseDate: "2026-09-02", memberName: "Dan", id: "c" },
      { expenseDate: "2026-09-01", memberName: "Ana", id: "a" },
      { expenseDate: "2026-09-01", memberName: "Aaron", id: "d" },
    ];

    expect(rows.toSorted(compareFamilyExpenses).map((entry) => entry.id)).toEqual(["c", "d", "a", "b"]);
  });
});
