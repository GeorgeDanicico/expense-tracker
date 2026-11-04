import { describe, expect, it } from "vitest";

import type { AccountMembership } from "@/lib/account/types";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import { DEFAULT_KID_PERMISSIONS, type Permissions } from "@/lib/permissions";

import { NAV_ITEMS, NAV_SECTIONS, activeItem, activeSection, navigationFor, segmentsFor } from "./nav-items";

const hrefs = (items: { href: string }[]) => items.map((item) => item.href);
const allHrefs = hrefs(Object.values(NAV_ITEMS)).sort();

const parent: AccountMembership = { memberId: "60000000-0000-4000-8000-000000000001", role: "parent", isCreator: true, familyName: "Popescu", permissions: PARENT_PERMISSIONS };
const kid = (overrides: Partial<Permissions> = {}): AccountMembership => ({
  memberId: "60000000-0000-4000-8000-000000000002",
  role: "kid",
  isCreator: false,
  familyName: "Popescu",
  permissions: { ...DEFAULT_KID_PERMISSIONS, ...overrides },
});

/** What a user sees as `section label: item labels`, in order. */
const outline = (membership: AccountMembership | null | undefined) =>
  navigationFor(membership).sections.map((section) => `${section.label}: ${section.items.map((item) => item.label).join(", ")}`);

describe("navigation sections", () => {
  it("is Home, Money, Planning and More, the bottom bar around its +", () => {
    expect(NAV_SECTIONS.map((section) => section.key)).toEqual(["home", "money", "planning", "more"]);
  });

  it("reaches every destination exactly once", () => {
    expect(hrefs(NAV_SECTIONS.flatMap((section) => section.items)).sort()).toEqual(allHrefs);
  });

  it("keeps every page at its existing URL", () => {
    expect(hrefs(Object.values(NAV_ITEMS)).sort()).toEqual(
      ["/calendar", "/dashboard", "/expenses", "/insights", "/investments", "/net-worth", "/reminders", "/settings", "/todos"],
    );
  });

  it("makes Reminders a badged destination for everyone, and To-dos and Calendar family-only", () => {
    expect(NAV_ITEMS.reminders).toMatchObject({ href: "/reminders", label: "Reminders", badge: "reminders" });
    expect(NAV_ITEMS.reminders).not.toHaveProperty("requiresFamily");
    expect(NAV_ITEMS.reminders).not.toHaveProperty("module");
    expect(NAV_ITEMS.todos).toMatchObject({ href: "/todos", requiresFamily: true });
    expect(NAV_ITEMS.calendar).toMatchObject({ href: "/calendar", requiresFamily: true });
  });
});

describe("navigationFor", () => {
  it("gives a user without a family Planning with Reminders alone", () => {
    expect(outline(null)).toEqual([
      "Home: Home",
      "Money: Expenses, Investments, Net worth, Insights",
      "Planning: Reminders",
      "More: Settings",
    ]);
  });

  it("shows everything to a parent", () => {
    expect(outline(parent)).toEqual([
      "Home: Home",
      "Money: Expenses, Investments, Net worth, Insights",
      "Planning: Reminders, To-dos, Calendar",
      "More: Settings",
    ]);
  });

  it("shows the module items and Reminders but not To-dos or Calendar while the account is loading", () => {
    expect(outline(undefined)).toEqual([
      "Home: Home",
      "Money: Expenses, Investments, Net worth, Insights",
      "Planning: Reminders",
      "More: Settings",
    ]);
  });

  it("leaves a kid with only expenses on Money with Expenses alone, and the family pages", () => {
    expect(outline(kid())).toEqual(["Home: Home", "Money: Expenses, Insights", "Planning: Reminders, To-dos, Calendar", "More: Settings"]);
  });

  it("shows each money module a kid has turned on, and no empty segments", () => {
    expect(outline(kid({ investments: "edit" }))[1]).toBe("Money: Expenses, Investments, Insights");
    expect(outline(kid({ net_worth: "edit" }))[1]).toBe("Money: Expenses, Net worth, Insights");
    expect(outline(kid({ expenses: "off", investments: "edit" }))[1]).toBe("Money: Investments");
    expect(outline(kid({ expenses: "off", net_worth: "edit" }))[1]).toBe("Money: Net worth");
    expect(outline(kid({ investments: "edit", net_worth: "edit" }))[1]).toBe("Money: Expenses, Investments, Net worth, Insights");
  });

  it("drops Money for a kid with every money module off, keeping the other three", () => {
    expect(outline(kid({ expenses: "off" }))).toEqual(["Home: Home", "Planning: Reminders, To-dos, Calendar", "More: Settings"]);
  });

  it("sends each tab to its first page, and More to /more", () => {
    const tabs = (membership: AccountMembership | null | undefined) => navigationFor(membership).sections.map((section) => section.href);
    expect(tabs(parent)).toEqual(["/dashboard", "/expenses", "/reminders", "/more"]);
    expect(tabs(kid({ expenses: "off", investments: "edit" }))).toEqual(["/dashboard", "/investments", "/reminders", "/more"]);
  });
});

describe("the active section", () => {
  const sections = navigationFor(parent).sections;
  const where = (pathname: string) => {
    const section = activeSection(sections, pathname);
    return [section?.key, section ? activeItem(section, pathname)?.label : undefined];
  };

  it.each([
    ["/dashboard", "home", "Home"],
    ["/expenses", "money", "Expenses"],
    ["/expenses/import", "money", "Expenses"],
    ["/investments", "money", "Investments"],
    ["/investments/some-asset", "money", "Investments"],
    ["/net-worth", "money", "Net worth"],
    ["/insights", "money", "Insights"],
    ["/reminders", "planning", "Reminders"],
    ["/todos", "planning", "To-dos"],
    ["/calendar", "planning", "Calendar"],
    ["/settings", "more", "Settings"],
    ["/settings/family/manage", "more", "Settings"],
    ["/settings/notifications", "more", "Settings"],
  ])("puts %s in %s, on %s", (pathname, key, label) => {
    expect(where(pathname)).toEqual([key, label]);
  });

  it("puts /more in More with no page of its own", () => {
    expect(where("/more")).toEqual(["more", undefined]);
  });

  it("doesn't match a path that only starts with a page's URL", () => {
    expect(where("/expenses-old")).toEqual([undefined, undefined]);
    expect(where("/")).toEqual([undefined, undefined]);
  });
});

describe("segmentsFor", () => {
  const sectionOf = (membership: AccountMembership | null, key: string) => navigationFor(membership).sections.find((section) => section.key === key)!;

  it("lists a section's pages by their URLs", () => {
    expect(segmentsFor(sectionOf(parent, "money"))).toEqual([
      { value: "/expenses", label: "Expenses" },
      { value: "/investments", label: "Investments" },
      { value: "/net-worth", label: "Net worth" },
      { value: "/insights", label: "Insights" },
    ]);
    expect(segmentsFor(sectionOf(parent, "planning"))).toEqual([
      { value: "/reminders", label: "Reminders" },
      { value: "/todos", label: "To-dos" },
      { value: "/calendar", label: "Calendar" },
    ]);
  });

  it("has no segmented control for a section with one page", () => {
    expect(segmentsFor(sectionOf(null, "planning"))).toBeNull();
    // Investments alone: Insights belongs to the expenses permission.
    expect(segmentsFor(sectionOf(kid({ expenses: "off", investments: "edit" }), "money"))).toBeNull();
    expect(segmentsFor(sectionOf(parent, "home"))).toBeNull();
    expect(segmentsFor(sectionOf(parent, "more"))).toBeNull();
  });

  it("follows the permissions: Insights comes with Expenses, so a kid with it gets two segments, three with investments", () => {
    expect(segmentsFor(sectionOf(kid(), "money"))?.map((segment) => segment.value)).toEqual(["/expenses", "/insights"]);
    expect(segmentsFor(sectionOf(kid({ investments: "edit" }), "money"))?.map((segment) => segment.value)).toEqual(["/expenses", "/investments", "/insights"]);
  });

  it("puts Insights last in Money, for everyone who reaches Expenses", () => {
    for (const membership of [null, parent, kid()]) expect(outline(membership)[1]).toMatch(/^Money: Expenses.*Insights$/);
    expect(outline(kid({ expenses: "off", investments: "edit" }))[1]).not.toContain("Insights");
  });
});
