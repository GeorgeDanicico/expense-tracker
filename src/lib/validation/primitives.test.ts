import { describe, expect, it } from "vitest";

import { calendarDate, currencyCode, decimalString, idSchema } from "@/lib/validation/primitives";

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe("idSchema", () => {
  it("accepts a UUID and rejects anything else with the given message", () => {
    expect(idSchema().safeParse("6f1c2c1e-6c1f-4a8e-9f0a-3c1d2e3f4a5b").success).toBe(true);

    expect(messages(idSchema("Item identifier is invalid.").safeParse("item-1"))).toEqual(["Item identifier is invalid."]);
  });
});

describe("decimalString", () => {
  it.each([
    { kind: "positive" as const, expected: "Amount must be a positive decimal." },
    { kind: "nonnegative" as const, expected: "Amount must be a nonnegative decimal." },
  ])("words the format error as a $kind decimal", ({ kind, expected }) => {
    const schema = decimalString({ label: "Amount", kind });

    expect(messages(schema.safeParse("-1"))[0]).toBe(expected);
  });

  it("rejects zero unless allowed, and keeps the trimmed string", () => {
    const strict = decimalString({ label: "Value", kind: "positive" });
    const lenient = decimalString({ label: "Value", allowZero: true, kind: "nonnegative" });

    expect(messages(strict.safeParse("0"))).toEqual(["Value must be greater than zero."]);
    expect(lenient.parse(" 0.50 ")).toBe("0.50");
  });

  it("limits integer and decimal digits", () => {
    const schema = decimalString({ label: "Value", kind: "positive" });

    expect(messages(schema.safeParse("1.12345678901"))).toEqual([
      "Value must have at most 18 integer digits and 10 decimal places.",
    ]);
  });
});

describe("currencyCode", () => {
  it("uppercases a trimmed three-letter code and rejects other input", () => {
    expect(currencyCode.parse(" eur ")).toBe("EUR");

    expect(messages(currencyCode.safeParse("EURO"))).toEqual(["Currency must be a three-letter code."]);
  });
});

describe("calendarDate", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(calendarDate.safeParse("2028-02-29").success).toBe(true);

    expect(messages(calendarDate.safeParse("2026-02-30"))).toEqual(["Choose a real calendar date."]);
  });
});
