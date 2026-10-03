import { describe, expect, it } from "vitest";

import { expenseClassificationLabel, subtypesForCategory, subtypeForCategory } from "@/lib/expenses/categories";
import { expenseSchema } from "@/lib/validation/expense";

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
      if (!result.success) expect(result.error.flatten().fieldErrors.subtype).toHaveLength(1);
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
