import { describe, expect, it } from "vitest";

import { MORE_ITEMS, MORE_SECTIONS, NAV_ITEMS, NAV_SECTIONS, TAB_BAR_ITEMS } from "./nav-items";

const hrefs = (items: { href: string }[]) => items.map((item) => item.href);
const allHrefs = hrefs(Object.values(NAV_ITEMS)).sort();

describe("navigation sections", () => {
  it("reaches every destination exactly once on desktop", () => {
    const desktop = [NAV_ITEMS.home, ...NAV_SECTIONS.flatMap((section) => section.items), NAV_ITEMS.settings];
    expect(hrefs(desktop).sort()).toEqual(allHrefs);
  });

  it("reaches every destination exactly once on mobile", () => {
    expect([...hrefs(TAB_BAR_ITEMS), ...hrefs(MORE_ITEMS)].sort()).toEqual(allHrefs);
  });

  it("drops tab-bar destinations from the More sheet but keeps the section", () => {
    expect(MORE_SECTIONS).toEqual([{ label: "Finance", items: [NAV_ITEMS.investments, NAV_ITEMS.netWorth] }]);
  });

  it("never lists an empty section", () => {
    expect(NAV_SECTIONS.every((section) => section.items.length > 0)).toBe(true);
  });
});
