import { describe, expect, it } from "vitest";

import { parseZfPage } from "@/lib/investments/quotes/zf";

// The pages are the price service's own samples (investments-scraper, ZfPriceParserTest).
describe("parseZfPage", () => {
  it("reads the fund's unit value and date from its box", () => {
    const html = `
      <div class="fond-mutual">
          <h1 class="articleTitle h1">BT Euro Clasic</h1>
          <p><strong style="color: #b51517; font-size:22px">13,5200  eur</strong></p>
          <p style="font-size:11px">Valoarea unității de fond VUAN din data de 2026-09-09</p>
      </div>`;

    expect(parseZfPage("BTEUROCLASIC", html)).toEqual({
      instrument: "BTEUROCLASIC",
      price: "13.5200",
      currency: "EUR",
      asOf: "2026-09-09",
      source: "ZF",
    });
  });

  it("skips nested elements before the price, and markup inside it", () => {
    const html = `
      <div class='main fond-mutual'>
          <div style="padding-left: 5px; float:right">
              <div id="div_chart_1"></div>
              <div id="div_chart_2"></div>
          </div>
          <p><strong><span>13,5180</span>&nbsp;eur</strong></p>
          <p style="font-size:11px">VUAN din data de 2026-09-15</p>
      </div>`;

    expect(parseZfPage("BTEUROCLASIC", html)).toMatchObject({ price: "13.5180", currency: "EUR", asOf: "2026-09-15" });
  });

  it.each([
    ["no fund box", `<p><strong>13,52 eur</strong></p><p style="font-size:11px">2026-09-09</p>`],
    ["no currency", `<div class="fond-mutual"><p><strong>13,52</strong></p><p style="font-size:11px">2026-09-09</p></div>`],
    ["no date", `<div class="fond-mutual"><p><strong>13,52 eur</strong></p></div>`],
    ["an impossible date", `<div class="fond-mutual"><p><strong>13,52 eur</strong></p><p style="font-size:11px">2026-02-30</p></div>`],
    ["no number", `<div class="fond-mutual"><p><strong>n/a</strong></p><p style="font-size:11px">2026-09-09</p></div>`],
  ])("gives no quote for a page with %s", (_, html) => {
    expect(parseZfPage("BTEUROCLASIC", html)).toBeNull();
  });
});
