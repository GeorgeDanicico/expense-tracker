import { describe, expect, it } from "vitest";

import type { Expense } from "@/lib/expenses/types";
import { changesStartMonth, isNotable, spendingChanges } from "@/lib/insights/changes";

import { anExpense } from "@/test/builders";

let next = 0;
const spent = (expenseDate: string, amount: number, overrides: Partial<Expense> = {}) =>
  anExpense({ id: `expense-${(next += 1)}`, expenseDate, amount, ...overrides });

/** A steady base so small changes stay under the threshold: 1,000 of housing every month. */
const rent = (month: string) => spent(`${month}-01`, 1000, { description: "Rent", category: "housing" });
const base = ["2026-07", "2026-08", "2026-09", "2026-10"].map(rent);

const FINISHED = "2026-11-20";

describe("spendingChanges", () => {
  it("compares a category with the month before and the three months' average", () => {
    const result = spendingChanges([
      ...base,
      spent("2026-07-05", 300), spent("2026-08-05", 300), spent("2026-09-05", 300), spent("2026-10-05", 600),
    ], "2026-10", FINISHED);

    expect(result.previousMonth).toBe("2026-09");
    expect(result.throughDay).toBeNull();
    expect(result.changes).toContainEqual(expect.objectContaining({
      kind: "category", key: "groceries", label: "Groceries", current: 600, previous: 300, average: 300, difference: 300, change: 100, averageChange: 100,
    }));
    expect(result.total).toEqual(expect.objectContaining({ current: 1600, previous: 1300, average: 1300, change: 23 }));
  });

  it("compares a merchant across its stores and cities", () => {
    const result = spendingChanges([
      ...base,
      spent("2026-09-03", 200, { description: "Kaufland Satu Mare" }),
      spent("2026-10-03", 250, { description: "Kaufland Cluj-Manastur" }),
      spent("2026-10-12", 250, { description: "Kaufland" }),
      spent("2026-09-04", 200, { description: "Lidl" }),
      spent("2026-10-04", 200, { description: "Lidl" }),
    ], "2026-10", FINISHED);

    expect(result.changes).toContainEqual(expect.objectContaining({ kind: "merchant", key: "kaufland", label: "Kaufland", current: 500, previous: 200, change: 150 }));
    expect(result.changes.find((item) => item.key === "lidl")).toBeUndefined();
  });

  it("compares the car's subtypes", () => {
    const result = spendingChanges([
      ...base,
      spent("2026-09-02", 200, { description: "OMV", category: "car", subtype: "car_fuel" }),
      spent("2026-10-02", 450, { description: "OMV", category: "car", subtype: "car_fuel" }),
      spent("2026-09-10", 100, { description: "Car wash", category: "car", subtype: "car_maintenance" }),
      spent("2026-10-10", 100, { description: "Car wash", category: "car", subtype: "car_maintenance" }),
    ], "2026-10", FINISHED);

    expect(result.changes.map((item) => `${item.kind}:${item.key}`)).toEqual(["category:car", "subtype:car_fuel"]);
    expect(result.changes[1]).toEqual(expect.objectContaining({ label: "Car Fuel", category: "car", current: 450, previous: 200 }));
  });

  it("leaves out a merchant or subtype that only repeats its category", () => {
    const result = spendingChanges([
      ...base,
      spent("2026-09-02", 200, { description: "OMV 1642 Satu Mare", category: "car", subtype: "car_fuel" }),
      spent("2026-10-02", 450, { description: "OMV 1947 Satu Mare", category: "car", subtype: "car_fuel" }),
    ], "2026-10", FINISHED);

    expect(result.changes.map((item) => `${item.kind}:${item.key}`)).toEqual(["category:car"]);
  });

  it("keeps drops as well as rises, biggest first", () => {
    const result = spendingChanges([
      ...base,
      spent("2026-09-05", 600), spent("2026-10-05", 200),
      spent("2026-09-06", 100, { description: "Cinema", category: "entertainment" }),
      spent("2026-10-06", 250, { description: "Cinema", category: "entertainment" }),
    ], "2026-10", FINISHED);

    expect(result.changes.filter((item) => item.kind === "category").map((item) => [item.key, item.difference])).toEqual([["groceries", -400], ["entertainment", 150]]);
  });

  it("ignores changes that are small against the month's spending or in percent", () => {
    const result = spendingChanges([
      ...base,
      spent("2026-09-05", 10, { description: "Coffee shop", category: "entertainment" }),
      spent("2026-10-05", 30, { description: "Coffee shop", category: "entertainment" }),
      spent("2026-09-06", 900, { description: "Market", category: "groceries" }),
      spent("2026-10-06", 1000, { description: "Market", category: "groceries" }),
    ], "2026-10", FINISHED);

    expect(result.changes).toEqual([]);
  });

  it("counts something new once it's big enough", () => {
    const result = spendingChanges([...base, spent("2026-10-08", 400, { description: "Dentist", category: "health" })], "2026-10", FINISHED);

    expect(result.changes).toContainEqual(expect.objectContaining({ kind: "category", key: "health", current: 400, previous: 0, change: null }));
  });

  it("compares the current month up to today with the same days of each month before", () => {
    const result = spendingChanges([
      ...base,
      spent("2026-09-05", 300), spent("2026-09-25", 900),
      spent("2026-10-05", 600),
    ], "2026-10", "2026-10-10");

    expect(result.throughDay).toBe(10);
    expect(result.changes).toContainEqual(expect.objectContaining({ key: "groceries", current: 600, previous: 300 }));
  });

  it("compares the 31st with the whole of a shorter month", () => {
    const result = spendingChanges([
      spent("2026-11-30", 100, { category: "housing" }),
      spent("2026-12-31", 100, { category: "housing" }),
    ], "2026-12", "2026-12-31");

    expect(result.total).toEqual(expect.objectContaining({ current: 100, previous: 100 }));
  });

  it("averages only the months since the first expense", () => {
    const result = spendingChanges([rent("2026-09"), rent("2026-10"), spent("2026-09-05", 200), spent("2026-10-05", 400)], "2026-10", FINISHED);

    expect(result.changes).toContainEqual(expect.objectContaining({ key: "groceries", average: 200 }));
  });

  it("has no average and no changes with nothing before the month", () => {
    const result = spendingChanges([spent("2026-10-05", 400)], "2026-10", FINISHED);

    expect(result.total.average).toBeNull();
    expect(result.changes).toEqual([]);
  });

  it("ignores expenses outside the months it compares", () => {
    const result = spendingChanges([...base, spent("2026-06-05", 5000), spent("2026-11-05", 5000)], "2026-10", FINISHED);

    expect(result.total.current).toBe(1000);
    expect(changesStartMonth("2026-10")).toBe("2026-07");
  });
});

describe("isNotable", () => {
  it("needs a month before, a big enough amount and a big enough percent", () => {
    expect(isNotable({ difference: 100, change: 50 }, 0)).toBe(false);
    expect(isNotable({ difference: 29, change: 50 }, 1000)).toBe(false);
    expect(isNotable({ difference: 30, change: 14 }, 1000)).toBe(false);
    expect(isNotable({ difference: -30, change: -15 }, 1000)).toBe(true);
    expect(isNotable({ difference: 30, change: null }, 1000)).toBe(true);
  });
});
