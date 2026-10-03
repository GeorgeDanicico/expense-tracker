import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildExpenseWorkbook } from "@/lib/export/xlsx";
import type { Expense } from "@/lib/types";

describe("expense workbook", () => {
  it("exports subtype labels while preserving numeric amount cells and the total formula", () => {
    const base: Expense = { id: "1", description: "Fuel & service", amount: 12.5, category: "car", subtype: "car_fuel", expenseDate: "2026-09-01", notes: null };
    const files = unzipSync(buildExpenseWorkbook([base, { ...base, id: "2", subtype: null, amount: 5 }], "RON"));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('r="F1"');
    expect(sheet).toContain("Subtype");
    expect(sheet).toContain('r="F2" t="inlineStr" s="0"><is><t xml:space="preserve">Car Fuel</t>');
    expect(sheet).toContain('r="F3" t="inlineStr" s="0"><is><t xml:space="preserve"></t>');
    expect(sheet).toContain('r="D2" s="1"><v>12.50</v>');
    expect(sheet).toContain("<f>SUM(D2:D3)</f><v>17.50</v>");
    expect(sheet).toContain('autoFilter ref="A1:F3"');
    expect(sheet).toContain("Fuel &amp; service");
  });
});
