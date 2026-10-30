import { describe, expect, it } from "vitest";

import { anExpense } from "@/test/builders";

import { FakeExpenseRepository } from "./expenses";

describe("FakeExpenseRepository.listRange", () => {
  it("lists the user's expenses from the start date up to, not including, the end, newest first", async () => {
    const expenses = new FakeExpenseRepository();
    expenses.expenses.set("owner", [
      anExpense({ id: "before", expenseDate: "2026-09-30" }),
      anExpense({ id: "first", expenseDate: "2026-10-01" }),
      anExpense({ id: "last", expenseDate: "2026-10-15" }),
      anExpense({ id: "end", expenseDate: "2026-10-16" }),
    ]);
    expenses.expenses.set("other", [anExpense({ id: "foreign", expenseDate: "2026-10-10" })]);

    const listed = await expenses.listRange("owner", { start: "2026-10-01", endExclusive: "2026-10-16" });

    expect(listed.map((expense) => expense.id)).toEqual(["last", "first"]);
  });
});

describe("FakeExpenseRepository.recentCategoriesByMerchant", () => {
  it("lists the user's categorised expenses since the date, newest first, without Other and without other users' expenses", async () => {
    const expenses = new FakeExpenseRepository();
    expenses.expenses.set("owner", [
      anExpense({ id: "old", description: "Lidl", category: "groceries", expenseDate: "2025-01-01" }),
      anExpense({ id: "fuel", description: "Station", category: "car", subtype: "car_fuel", expenseDate: "2026-09-02" }),
      anExpense({ id: "cafe", description: "Cafe", category: "other", expenseDate: "2026-09-03" }),
      anExpense({ id: "lidl", description: "Lidl", category: "groceries", expenseDate: "2026-09-04" }),
    ]);
    expenses.expenses.set("other", [anExpense({ id: "foreign", description: "Zara", category: "shopping", expenseDate: "2026-09-05" })]);

    const history = await expenses.recentCategoriesByMerchant("owner", "2025-10-30");

    expect(history).toEqual([
      { description: "Lidl", category: "groceries", subtype: null, expenseDate: "2026-09-04" },
      { description: "Station", category: "car", subtype: "car_fuel", expenseDate: "2026-09-02" },
    ]);
  });
});
