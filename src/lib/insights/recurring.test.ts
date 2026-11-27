import { describe, expect, it } from "vitest";

import type { Expense } from "@/lib/expenses/types";
import { recurringPayments, recurringStartMonth } from "@/lib/insights/recurring";

import { anExpense } from "@/test/builders";

let next = 0;
const charge = (expenseDate: string, amount: number, description: string, overrides: Partial<Expense> = {}) =>
  anExpense({ id: `expense-${(next += 1)}`, expenseDate, amount, description, category: "entertainment", ...overrides });

const monthly = (description: string, amounts: number[], startMonth = "2026-07", day = "12") =>
  amounts.map((amount, index) => {
    const [year, month] = startMonth.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 + index, 1));
    return charge(`${date.toISOString().slice(0, 7)}-${day}`, amount, description);
  });

describe("recurringPayments", () => {
  it("finds a merchant charged about the same each month, three months or more in a row", () => {
    const result = recurringPayments(monthly("Netflix.com Amsterdam", [49, 49, 49, 49]), "2026-10");

    expect(result.payments).toEqual([{ key: "netflix", label: "Netflix", category: "entertainment", amount: 49, previousAmount: 49, months: 4, lastMonth: "2026-10", charged: true }]);
    expect(result.monthlyTotal).toBe(49);
  });

  it("shows a price change", () => {
    const [payment] = recurringPayments(monthly("Spotify", [25, 25, 30]), "2026-09").payments;

    expect(payment).toEqual(expect.objectContaining({ amount: 30, previousAmount: 25 }));
  });

  it("still counts one not charged yet this month", () => {
    const [payment] = recurringPayments(monthly("Gym membership club", [150, 150, 150]), "2026-10").payments;

    expect(payment).toEqual(expect.objectContaining({ lastMonth: "2026-09", charged: false, months: 3 }));
  });

  it("drops one that stopped before the month before", () => {
    expect(recurringPayments(monthly("Spotify", [25, 25, 25]), "2026-11").payments).toEqual([]);
  });

  it("needs three months in a row", () => {
    const gap = [charge("2026-07-12", 25, "Spotify"), charge("2026-08-12", 25, "Spotify"), charge("2026-10-12", 25, "Spotify")];

    expect(recurringPayments(gap, "2026-10").payments).toEqual([]);
  });

  it("leaves out a shop visited every week", () => {
    const shopping = ["07", "08", "09"].flatMap((month) => ["03", "10", "17", "24"].map((day) => charge(`2026-${month}-${day}`, 50, "Kaufland Satu Mare", { category: "groceries" })));

    expect(recurringPayments(shopping, "2026-09").payments).toEqual([]);
  });

  it("leaves out amounts that vary a lot", () => {
    expect(recurringPayments(monthly("Corner Restaurant", [80, 200, 120]), "2026-09").payments).toEqual([]);
  });

  it("leaves out generic descriptions", () => {
    expect(recurringPayments(monthly("Transport", [100, 100, 100]), "2026-09").payments).toEqual([]);
  });

  it("orders by amount and adds up the monthly cost", () => {
    const result = recurringPayments([...monthly("Spotify", [25, 25, 25]), ...monthly("Bank Premium Club subscription", [40, 40, 40], "2026-07", "01")], "2026-09");

    expect(result.payments.map((payment) => payment.label)).toEqual(["Bank Premium Club subscription", "Spotify"]);
    expect(result.monthlyTotal).toBe(65);
  });

  it("looks back six months", () => {
    expect(recurringStartMonth("2026-10")).toBe("2026-04");
  });
});
