import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import { useApiForm } from "@/hooks/use-api-form";

import { ExpenseForm } from "./expense-form";

function FormUnderTest({ selectedMonth }: { selectedMonth: string }) {
  const form = useApiForm();
  return <ExpenseForm id="expense-form" selectedMonth={selectedMonth} currency="EUR" form={form} onSuccess={() => undefined} />;
}

function renderForm(selectedMonth: string) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <FormUnderTest selectedMonth={selectedMonth} />
    </ChakraProvider>,
  );
}

/** The `value` of the date input. */
function dateValue(html: string) {
  return /<input[^>]*name="expenseDate"[^>]*>/.exec(html)?.[0].match(/value="([^"]*)"/)?.[1];
}

describe("ExpenseForm date", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 4 November 2026, 10:00 in Bucharest.
    vi.setSystemTime(new Date("2026-11-04T08:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("defaults to today in the current month, not its last day", () => {
    const html = renderForm("2026-11");
    expect(dateValue(html)).toBe("2026-11-04");
    expect(html).toContain('min="2026-11-01"');
    expect(html).toContain('max="2026-11-30"');
  });

  it("defaults to the last day of a past month", () => {
    expect(dateValue(renderForm("2026-10"))).toBe("2026-10-31");
  });

  it("uses the application's day just after midnight in Bucharest", () => {
    vi.setSystemTime(new Date("2026-11-04T22:30:00Z")); // 00:30 on 5 November in Bucharest
    expect(dateValue(renderForm("2026-11"))).toBe("2026-11-05");
  });
});
