import { describe, expect, it } from "vitest";

import { expensesMenuItems } from "@/components/expenses/expenses-menu";

const values = (...args: Parameters<typeof expensesMenuItems>) => expensesMenuItems(...args).map((item) => item.value);
const exportHref = "/api/expenses/export?month=2026-11";

describe("the Expenses screen's ⋯", () => {
  it("holds import and export on your own month", () => {
    const items = expensesMenuItems({ readOnly: false, family: false, tab: null, exportHref });
    expect(items.map((item) => item.value)).toEqual(["import", "export"]);
    expect(items[0]).toMatchObject({ label: "Import a statement", href: "/expenses/import" });
    expect(items[1]).toMatchObject({ label: "Export this month", href: exportHref });
  });

  it("has no import on another member's month (an import only adds your own expenses), but keeps export", () => {
    expect(values({ readOnly: true, family: false, tab: null, exportHref })).toEqual(["export"]);
  });

  it("is empty on the family view, which can't be exported or imported into", () => {
    expect(values({ readOnly: true, family: true, tab: null, exportHref })).toEqual([]);
  });

  it("holds a saved tab's Edit and Delete on that tab, and only your own", () => {
    expect(values({ readOnly: false, family: false, tab: { name: "Car" }, exportHref })).toEqual(["edit-tab", "delete-tab"]);
    expect(expensesMenuItems({ readOnly: false, family: false, tab: { name: "Car" }, exportHref })[0].label).toBe("Edit “Car”");
    expect(values({ readOnly: true, family: false, tab: { name: "Car" }, exportHref })).toEqual([]);
  });
});
