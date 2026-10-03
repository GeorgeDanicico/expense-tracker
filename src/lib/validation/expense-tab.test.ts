import { describe, expect, it } from "vitest";

import { expenseTabSchema } from "@/lib/validation/expense-tab";

describe("expense tab selections", () => {
  it("trims names, deduplicates choices and drops children covered by a parent", () => {
    expect(expenseTabSchema.parse({
      name: "  Car spending  ", categoryKeys: ["car", "car", "transport"],
      subtypeKeys: ["car_fuel", "car_fuel", "car_repairs"],
    })).toEqual({ name: "Car spending", categoryKeys: ["car", "transport"], subtypeKeys: [] });
  });

  it("preserves an individual subtype without selecting its parent", () => {
    expect(expenseTabSchema.parse({
      name: "Fuel", categoryKeys: [], subtypeKeys: ["car_fuel", "car_fuel"],
    })).toEqual({ name: "Fuel", categoryKeys: [], subtypeKeys: ["car_fuel"] });
  });

  it.each([
    { name: " ", categoryKeys: ["car"], subtypeKeys: [] },
    { name: "Empty", categoryKeys: [], subtypeKeys: [] },
    { name: "Invalid", categoryKeys: ["boats"], subtypeKeys: [] },
    { name: "Invalid", categoryKeys: [], subtypeKeys: ["diesel"] },
    { name: "Invalid", categoryKeys: [null], subtypeKeys: [] },
    { name: "Invalid", categoryKeys: [], subtypeKeys: [null] },
    { name: "x".repeat(81), categoryKeys: ["car"], subtypeKeys: [] },
  ])("rejects invalid names and selections: %j", (input) => {
    expect(expenseTabSchema.safeParse(input).success).toBe(false);
  });
});
