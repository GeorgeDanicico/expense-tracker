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
    expect(MORE_SECTIONS).toEqual([
      { label: "Finance", items: [NAV_ITEMS.investments, NAV_ITEMS.netWorth] },
      { label: "Planning", items: [NAV_ITEMS.reminders, NAV_ITEMS.todos] },
    ]);
  });

  it("puts Reminders then To-dos in a Planning section of the More sheet, not the tab bar", () => {
    expect(NAV_SECTIONS.at(-1)).toEqual({ label: "Planning", items: [NAV_ITEMS.reminders, NAV_ITEMS.todos] });
    expect(TAB_BAR_ITEMS).not.toContain(NAV_ITEMS.todos);
    expect(TAB_BAR_ITEMS).not.toContain(NAV_ITEMS.reminders);
    expect(NAV_ITEMS.todos).toMatchObject({ href: "/todos", label: "To-dos", requiresFamily: true });
  });

  it("makes Reminders a badged destination for everyone", () => {
    expect(NAV_ITEMS.reminders).toMatchObject({ href: "/reminders", label: "Reminders", badge: "reminders" });
    expect(NAV_ITEMS.reminders).not.toHaveProperty("requiresFamily");
    expect(NAV_ITEMS.reminders).not.toHaveProperty("module");
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

const FINANCE = NAV_SECTIONS.filter((section) => section.label === "Finance");
const FINANCE_MORE = MORE_SECTIONS.filter((section) => section.label === "Finance");
const PLANNING_SOLO = { label: "Planning", items: [NAV_ITEMS.reminders] };
const PLANNING = { label: "Planning", items: [NAV_ITEMS.reminders, NAV_ITEMS.todos] };

describe("navigationFor", () => {
  it("shows a user without a family Reminders but not To-dos", () => {
    const nav = navigationFor(null);
    expect(nav.sections).toEqual([...FINANCE, PLANNING_SOLO]);
    expect(nav.tabBarItems).toEqual(TAB_BAR_ITEMS);
    expect(nav.moreSections).toEqual([...FINANCE_MORE, PLANNING_SOLO]);
    expect(nav.moreItems).toEqual(MORE_ITEMS.filter((item) => item !== NAV_ITEMS.todos));
    expect(nav.moreItems).toContain(NAV_ITEMS.reminders);
  });

  it("shows everything to a parent", () => {
    const parent: AccountMembership = { memberId: "60000000-0000-4000-8000-000000000001", role: "parent", isCreator: true, familyName: "Popescu", permissions: PARENT_PERMISSIONS };
    expect(navigationFor(parent).sections).toEqual(NAV_SECTIONS);
    expect(navigationFor(parent).moreItems).toEqual(MORE_ITEMS);
  });

  it("shows the module items and Reminders but not To-dos while the account is loading", () => {
    const nav = navigationFor(undefined);
    expect(nav.sections).toEqual([...FINANCE, PLANNING_SOLO]);
    expect(nav.moreItems).not.toContain(NAV_ITEMS.todos);
  });

  it("leaves a kid with only expenses enabled with Home, Expenses, Reminders, To-dos and Settings", () => {
    const nav = navigationFor(kid());
    expect(nav.sections).toEqual([
      { label: "Finance", items: [NAV_ITEMS.expenses] },
      PLANNING,
    ]);
    expect(nav.tabBarItems).toEqual(TAB_BAR_ITEMS);
    expect(nav.moreSections).toEqual([PLANNING]);
    expect(nav.moreItems).toEqual([NAV_ITEMS.reminders, NAV_ITEMS.todos, NAV_ITEMS.settings]);
  });

  it("drops the Finance section for a kid with every module off, keeping Planning", () => {
    const nav = navigationFor(kid({ ...DEFAULT_KID_PERMISSIONS, expenses: "off" }));
    expect(nav.sections).toEqual([PLANNING]);
    expect(nav.tabBarItems).toEqual([NAV_ITEMS.home]);
  });

  it("shows the modules a kid has turned on", () => {
    const nav = navigationFor(kid({ ...DEFAULT_KID_PERMISSIONS, net_worth: "edit" }));
    expect(nav.moreSections).toEqual([
      { label: "Finance", items: [NAV_ITEMS.netWorth] },
      PLANNING,
    ]);
  });
});
