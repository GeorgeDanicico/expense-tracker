import { describe, expect, it } from "vitest";

import { summarizeExpenses } from "@/lib/expenses/summary";

describe("summarizeExpenses", () => {
  it.each([
    { expenses: [], summary: { total: 0, count: 0, average: 0 } },
    { expenses: [{ amount: 10 }, { amount: 5 }], summary: { total: 15, count: 2, average: 7.5 } },
  ])("summarizes $expenses.length expenses without dividing by zero", ({ expenses, summary }) => {
    expect(summarizeExpenses(expenses)).toEqual(summary);
  });
});
