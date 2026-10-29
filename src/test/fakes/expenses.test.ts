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
