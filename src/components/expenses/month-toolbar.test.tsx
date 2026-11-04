import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ledgerSystem } from "@/components/ui/theme";
import { MonthToolbar, monthMenuMonths } from "./month-toolbar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function renderToolbar(month: string, maxMonth?: string) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <MonthToolbar month={month} maxMonth={maxMonth} href={(value) => `/expenses?month=${value}`} />
    </ChakraProvider>,
  );
}

describe("MonthToolbar month boundary", () => {
  it("renders a disabled next button without a future link at the boundary", () => {
    const html = renderToolbar("2027-01", "2027-01");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next month"/);
    expect(html).not.toContain("href=\"/expenses?month=2027-02\"");
    expect(html).toContain("href=\"/expenses?month=2026-12\"");
  });

  it("allows advancement from December to the current January", () => {
    const html = renderToolbar("2026-12", "2027-01");
    expect(html).toContain("href=\"/expenses?month=2027-01\"");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next month"/);
  });

  it("leaves navigation unrestricted when no maximum is supplied", () => {
    expect(renderToolbar("2027-01")).toContain("href=\"/expenses?month=2027-02\"");
  });

  it("names the month on a button that opens the month menu", () => {
    expect(renderToolbar("2026-11", "2026-11")).toMatch(/<button[^>]*aria-label="Month: November 2026"/);
  });
});

describe("monthMenuMonths", () => {
  it("lists the twelve months up to the maximum, newest first", () => {
    const months = monthMenuMonths("2026-03", "2026-11");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-11");
    expect(months.at(-1)).toBe("2025-12");
  });

  it("starts from the month shown when it is past the current month and there is no maximum", () => {
    expect(monthMenuMonths("2027-02", undefined, "2026-11")[0]).toBe("2027-02");
    expect(monthMenuMonths("2026-01", undefined, "2026-11")[0]).toBe("2026-11");
  });
});
