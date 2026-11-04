import { describe, expect, it } from "vitest";

import { expenseClassificationLabel, subtypesForCategory, subtypeForCategory } from "@/lib/expenses/categories";
import { expenseSchema, validateExpensePatch } from "@/lib/validation/expense";
import { fieldErrorsOf } from "@/lib/validation/field-errors";

const input = { description: "Car service", amount: "12.50", category: "car", expenseDate: "2026-09-01" };

describe("expense classifications", () => {
  it.each(["car_maintenance", "car_fuel", "car_repairs"])("accepts Car / %s", (subtype) => {
    expect(expenseSchema.parse({ ...input, subtype }).subtype).toBe(subtype);
  });

  it("keeps old callers and explicit no-subtype writes valid", () => {
    expect(expenseSchema.parse({ ...input, category: "transport" }).subtype).toBeNull();
    expect(expenseSchema.parse({ ...input, subtype: null }).subtype).toBeNull();
  });

  it("rejects wrong parent and unknown subtype with field errors", () => {
    for (const data of [{ ...input, category: "transport", subtype: "car_fuel" }, { ...input, subtype: "fuel" }]) {
      const result = expenseSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) expect(fieldErrorsOf(result.error).subtype).toHaveLength(1);
    }
  });

  it("clears an incompatible subtype on category change and limits offered choices", () => {
    expect(subtypeForCategory("groceries", "car_fuel")).toBeNull();
    expect(subtypeForCategory("car", "car_fuel")).toBe("car_fuel");
    expect(subtypesForCategory("car")).toEqual(["car_maintenance", "car_fuel", "car_repairs"]);
    expect(subtypesForCategory("transport")).toEqual([]);
  });

  it("labels both classifications and retains main-category-only labels", () => {
    expect(expenseClassificationLabel("car", "car_fuel")).toBe("Car / Car Fuel");
    expect(expenseClassificationLabel("transport", null)).toBe("Transport");
  });
});

describe("expense amounts (two decimal places)", () => {
  const amountOf = (amount: unknown) => expenseSchema.safeParse({ ...input, amount });
  const errorOf = (amount: unknown) => {
    const result = amountOf(amount);
    return result.success ? undefined : fieldErrorsOf(result.error).amount;
  };

  it.each([
    [0.1, 0.1],
    [0.29, 0.29],
    [0.01, 0.01],
    [12.34, 12.34],
    [12.3, 12.3],
    [12, 12],
    [1.1, 1.1],
    [4.35, 4.35],
    [9_999_999_999.99, 9_999_999_999.99],
    ["0.1", 0.1],
    ["0.29", 0.29],
    ["12.34", 12.34],
    ["12.340", 12.34],
    ["12.", 12],
    [".5", 0.5],
    [" 7.25 ", 7.25],
    ["1e3", 1000],
    ["1.25e1", 12.5],
    ["9999999999.99", 9_999_999_999.99],
    ["0.010", 0.01],
  ])("accepts %j", (amount, expected) => {
    const result = amountOf(amount);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe(expected);
  });

  it.each([
    ["0.004", "text below a cent"],
    [0.004, "a number below a cent"],
    [0.005, "a number that would round up to 0.01"],
    ["0.005", "text that would round up to 0.01"],
    [1.005, "1.005, which binary floating point stores as 1.00499999999999989..."],
    ["1.005", "the text 1.005"],
    [0.1 + 0.2, "the float sum 0.1 + 0.2"],
    ["0.30000000000000004", "the text of the float sum 0.1 + 0.2"],
    [1e-7, "1e-7"],
    ["1e-7", "the text 1e-7"],
    ["1.5e-3", "scientific text below a cent"],
    [12.345, "three decimals"],
    ["12.3456789", "many decimals as text"],
    ["10.001", "a thousandth above ten"],
    [9_999_999_999.999, "a large value with three decimals"],
    ["99999999999999.5", "a large value with one decimal"],
  ])("refuses %j (%s) with a field error on the amount", (...[amount]) => {
    const errors = errorOf(amount);
    expect(errors).toHaveLength(1);
    expect(errors?.[0]).toMatch(/two decimal places|greater than zero|at most/i);
  });

  it.each([0.004, "0.004", 0.005, "0.005", 1.005, 0.1 + 0.2, 1e-7, "12.345"])("names the decimal places for %j", (amount) => {
    expect(errorOf(amount)).toEqual(["Use at most two decimal places."]);
  });

  it.each([
    [0, "Amount must be greater than zero."],
    ["0", "Amount must be greater than zero."],
    ["0.00", "Amount must be greater than zero."],
    [-5, "Amount must be greater than zero."],
    ["-0.50", "Amount must be greater than zero."],
    [10_000_000_000, "Amount must be at most 9,999,999,999.99."],
    ["1e21", "Amount must be at most 9,999,999,999.99."],
    [1e21, "Amount must be at most 9,999,999,999.99."],
  ])("refuses %j (zero, negative or above the maximum)", (amount, message) => {
    const errors = errorOf(amount);
    expect(errors).toHaveLength(1);
    expect(errors).toEqual([message]);
  });

  it.each(["", "abc", "12,50", "1.2.3", "0x10", "Infinity", "NaN", "--1", Infinity, NaN, null, undefined, true, {}, [1]])(
    "refuses the non-amount %j",
    (amount) => {
      const errors = errorOf(amount);
      expect(errors?.length).toBeGreaterThan(0);
    },
  );
});

describe("validateExpensePatch", () => {
  it("keeps only the fields the patch names, checked and normalised", () => {
    expect(validateExpensePatch({ amount: "12.50" })).toEqual({ amount: 12.5 });
    expect(validateExpensePatch({ description: " Fuel ", notes: "  " })).toEqual({ description: "Fuel", notes: null });
    expect(validateExpensePatch({ subtype: null, expenseDate: "2026-09-02" })).toEqual({ subtype: null, expenseDate: "2026-09-02" });
  });

  it("checks a subtype against a category named with it, and leaves one named alone to the database", () => {
    expect(() => validateExpensePatch({ category: "transport", subtype: "car_fuel" })).toThrow("Choose a subtype belonging to the selected category.");
    expect(validateExpensePatch({ category: "car", subtype: "car_fuel" })).toEqual({ category: "car", subtype: "car_fuel" });
    expect(validateExpensePatch({ subtype: "car_fuel" })).toEqual({ subtype: "car_fuel" });
  });

  it("rejects an invalid field with expenseSchema's message", () => {
    expect(() => validateExpensePatch({ amount: "1.005" })).toThrow("Use at most two decimal places.");
    expect(() => validateExpensePatch({ description: "  " })).toThrow("Enter a description.");
  });
});

// Audit B8: a control character in a description made the spreadsheet export unreadable.
describe("control characters", () => {
  it("drops control characters from a description and turns line breaks and tabs into a space", () => {
    expect(expenseSchema.parse({ ...input, description: "Card\u0002 payment\u007F" }).description).toBe("Card payment");
    expect(expenseSchema.parse({ ...input, description: " Lidl\r\nCluj\tcentre " }).description).toBe("Lidl Cluj centre");
  });

  it("refuses a description of nothing but control characters as empty", () => {
    const result = expenseSchema.safeParse({ ...input, description: "\u0001\u0002" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrorsOf(result.error).description).toEqual(["Enter a description."]);
  });

  it("keeps line breaks in notes but drops other control characters", () => {
    expect(expenseSchema.parse({ ...input, notes: "Two\nlines\u0000" }).notes).toBe("Two\nlines");
  });

  it("cleans a patch the same way", () => {
    expect(validateExpensePatch({ description: "Fuel\u001B", notes: "a\u0007b" })).toEqual({ description: "Fuel", notes: "ab" });
  });
});
