import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";

import type { Expense } from "@/lib/expenses/types";
import { anExpense } from "@/test/builders";

import { dateChipLabel, DEFAULT_CATEGORY, ExpenseForm, latestExpenseDate, shownClassification } from "./expense-form";

function renderForm(expense?: Expense) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <ExpenseForm currency="EUR" expense={expense} onSaved={() => undefined} />
    </ChakraProvider>,
  );
}

describe("ExpenseForm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 4 November 2026, 10:00 in Bucharest.
    vi.setSystemTime(new Date("2026-11-04T08:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("asks for the amount first, on the decimal keypad, focused", () => {
    const html = renderForm();
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
    expect(inputs[0]).toContain('name="amount"');
    expect(inputs[0]).toContain('inputMode="decimal"');
    expect(inputs[0]).toMatch(/autofocus/i);
    expect(inputs[1]).toContain('name="description"');
  });

  it("starts on today, the default category, and notes folded away", () => {
    const html = renderForm();
    expect(html).toContain('aria-label="Date: Today"');
    expect(html).toContain('aria-label="Category: Groceries"');
    expect(html).toContain("More details");
    expect(html).toMatch(/aria-expanded="false"[^>]*>More details/);
    expect(html).not.toContain('name="expenseDate"');
  });

  it("edits an expense filled in, with its own classification and Save changes only", () => {
    const html = renderForm(anExpense({ description: "Fuel", amount: 61.2, category: "car", subtype: "car_fuel", expenseDate: "2026-10-31", notes: "Full tank" }));
    expect(html).toMatch(/<input[^>]*name="amount"[^>]*value="61.2"/);
    expect(html).toMatch(/<input[^>]*name="description"[^>]*value="Fuel"/);
    expect(html).toContain('aria-label="Category: Car"');
    expect(html).toContain('aria-label="Date: Oct 31"');
    // Notes and subtype are set, so More details starts open.
    expect(html).toMatch(/aria-expanded="true"[^>]*>More details/);
    expect(html).toContain("Full tank");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>.*Save changes/);
    expect(html).not.toContain("Save and add another");
  });

  it("has one big Save and Save and add another at the bottom", () => {
    const html = renderForm();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>.*Save expense/);
    expect(html).toContain("Save and add another");
    expect(html.lastIndexOf("Save expense")).toBeGreaterThan(html.indexOf("More details"));
  });
});

describe("dateChipLabel", () => {
  it("says Today, Yesterday or the day, with the year when it isn't this one", () => {
    expect(dateChipLabel("2026-11-04", "2026-11-04")).toBe("Today");
    expect(dateChipLabel("2026-11-03", "2026-11-04")).toBe("Yesterday");
    expect(dateChipLabel("2026-10-31", "2026-11-04")).toBe("Oct 31");
    expect(dateChipLabel("2025-12-31", "2026-01-02")).toBe("Dec 31, 2025");
  });
});

describe("shownClassification", () => {
  const guess = { category: "car", subtype: "car_fuel" } as const;

  it("shows the guess from the description until a category is chosen", () => {
    expect(shownClassification(null, guess)).toEqual(guess);
    expect(shownClassification({ category: "travel", subtype: null }, guess)).toEqual({ category: "travel", subtype: null });
  });

  it("falls back to the default for an unknown description", () => {
    expect(shownClassification(null, null)).toEqual({ category: DEFAULT_CATEGORY, subtype: null });
  });
});

// Audit B5: the picker's maximum was worked out from a local Date, a day early east of UTC+12.
describe("latestExpenseDate", () => {
  const zone = process.env.TZ;
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("is the last day of the current month, whatever the device's zone", () => {
    for (const tz of ["Pacific/Auckland", "Pacific/Kiritimati", "Europe/Bucharest", "Pacific/Pago_Pago"]) {
      process.env.TZ = tz;
      expect(latestExpenseDate("2026-10-15")).toBe("2026-10-31");
      expect(latestExpenseDate("2026-02-01")).toBe("2026-02-28");
      expect(latestExpenseDate("2028-02-29")).toBe("2028-02-29");
    }
  });
});
