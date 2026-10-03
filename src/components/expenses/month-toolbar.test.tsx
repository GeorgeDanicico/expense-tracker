import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ledgerSystem } from "@/components/ui/theme";
import { MonthToolbar } from "./month-toolbar";

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
    expect(html).toContain("max=\"2027-01\"");
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
});
