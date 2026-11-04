import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";

import { ValuedOnField } from "./add-net-worth-valuation-dialog";

function renderField(latestObservation: string | null) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <ValuedOnField latestObservation={latestObservation} />
    </ChakraProvider>,
  );
}

describe("ValuedOnField", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T08:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("defaults a new value to today, not the latest observation's date", () => {
    const html = renderField("2026-10-01");
    expect(html).toMatch(/name="valuedOn"[^>]*value="2026-11-04"/);
    expect(html).toContain("Latest observation: ");
  });

  it("defaults to today when there is no observation yet", () => {
    expect(renderField(null)).toMatch(/name="valuedOn"[^>]*value="2026-11-04"/);
  });
});
