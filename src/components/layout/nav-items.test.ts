import { describe, expect, it } from "vitest";

import type { AccountMembership } from "@/lib/account/types";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

import { MORE_ITEMS, MORE_SECTIONS, NAV_ITEMS, NAV_SECTIONS, TAB_BAR_ITEMS, navigationFor } from "./nav-items";

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

const kid = (permissions = DEFAULT_KID_PERMISSIONS): AccountMembership => ({
  memberId: "60000000-0000-4000-8000-000000000002",
  role: "kid",
  isCreator: false,
  familyName: "Popescu",
  permissions,
});

describe("navigationFor", () => {
  it("shows everything to a user without a family", () => {
    const nav = navigationFor(null);
    expect(nav.sections).toEqual(NAV_SECTIONS);
    expect(nav.tabBarItems).toEqual(TAB_BAR_ITEMS);
    expect(nav.moreItems).toEqual(MORE_ITEMS);
  });

  it("shows everything to a parent", () => {
    const parent: AccountMembership = { memberId: "60000000-0000-4000-8000-000000000001", role: "parent", isCreator: true, familyName: "Popescu", permissions: PARENT_PERMISSIONS };
    expect(navigationFor(parent).sections).toEqual(NAV_SECTIONS);
  });

  it("shows everything while the account is loading", () => {
    expect(navigationFor(undefined).sections).toEqual(NAV_SECTIONS);
  });

  it("leaves a kid with only expenses enabled with Home, Expenses and Settings", () => {
    const nav = navigationFor(kid());
    expect(nav.sections).toEqual([{ label: "Finance", items: [NAV_ITEMS.expenses] }]);
    expect(nav.tabBarItems).toEqual(TAB_BAR_ITEMS);
    expect(nav.moreSections).toEqual([]);
    expect(nav.moreItems).toEqual([NAV_ITEMS.settings]);
  });

  it("drops the Finance section for a kid with every module off", () => {
    const nav = navigationFor(kid({ ...DEFAULT_KID_PERMISSIONS, expenses: "off" }));
    expect(nav.sections).toEqual([]);
    expect(nav.tabBarItems).toEqual([NAV_ITEMS.home]);
  });

  it("shows the modules a kid has turned on", () => {
    const nav = navigationFor(kid({ ...DEFAULT_KID_PERMISSIONS, net_worth: "edit" }));
    expect(nav.moreSections).toEqual([{ label: "Finance", items: [NAV_ITEMS.netWorth] }]);
  });
});
