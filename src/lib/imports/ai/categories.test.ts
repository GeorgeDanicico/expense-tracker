import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MERCHANT_RULE_DESCRIPTIONS,
  assignCategories,
  buildHistory,
  historySince,
  matchesMerchantRule,
  planCategories,
} from "@/lib/imports/ai/categories";

describe("historySince", () => {
  it("is the same day a year earlier", () => {
    expect(historySince("2026-10-30")).toBe("2025-10-30");
  });

  it("moves 29 February to the 28th", () => {
    expect(historySince("2028-02-29")).toBe("2027-02-28");
  });
});

describe("buildHistory", () => {
  it("keeps the most recent expense of each normalised merchant", () => {
    const history = buildHistory([
      { description: "Lidl Cluj 1234", category: "groceries", subtype: null, expenseDate: "2026-09-04" },
      { description: "LIDL  Cluj", category: "shopping", subtype: null, expenseDate: "2026-02-01" },
      { description: "Station", category: "car", subtype: "car_fuel", expenseDate: "2026-08-01" },
    ]);

    expect(history.get("lidl cluj")).toEqual({ category: "groceries", subtype: null });
    expect(history.get("station")).toEqual({ category: "car", subtype: "car_fuel" });
    expect(history.size).toBe(2);
  });

  it("drops a subtype that doesn't belong to the category, and descriptions with nothing to match on", () => {
    const history = buildHistory([
      { description: "Odd", category: "health", subtype: "car_fuel", expenseDate: "2026-09-04" },
      { description: "12345", category: "health", subtype: null, expenseDate: "2026-09-04" },
    ]);

    expect(history.get("odd")).toEqual({ category: "health", subtype: null });
    expect(history.size).toBe(1);
  });
});

describe("matchesMerchantRule", () => {
  it("knows the descriptions the database rule knows, whatever their case or spacing", () => {
    expect(matchesMerchantRule("OMV 1642 Satu Mare")).toBe(true);
    expect(matchesMerchantRule("  omv   1642 satu mare ")).toBe(true);
    expect(matchesMerchantRule("Petrom")).toBe(true);
  });

  it("doesn't match a merchant that merely contains a known name", () => {
    expect(matchesMerchantRule("OMV 9999 Elsewhere")).toBe(false);
    expect(matchesMerchantRule("Petrom Cluj")).toBe(false);
    expect(matchesMerchantRule("Lidl")).toBe(false);
  });

  it("lists exactly the descriptions of the SQL rule, so a rule added there fails here", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../../../supabase/migrations/20261003112707_20261003100634_add_expense_merchant_classification.sql", import.meta.url)),
      "utf8",
    );
    const body = sql.slice(sql.indexOf("function expense_classification_private.merchant_key"), sql.indexOf("function expense_classification_private.inspect_merchant"));
    const rules = [...body.matchAll(/^\s*when '([^']+)' then '[^']+'/gm)].map((match) => match[1]);

    expect(rules.length).toBeGreaterThan(5);
    expect([...MERCHANT_RULE_DESCRIPTIONS].sort()).toEqual([...rules].sort());
  });
});

describe("planCategories and assignCategories", () => {
  const history = buildHistory([{ description: "Fresh Market 7", category: "groceries", subtype: null, expenseDate: "2026-09-01" }]);

  it("sorts rows into the rule's, the history's and the model's, and lists each unknown merchant once", () => {
    const plan = planCategories(
      ["Corner Cafe", "Fresh Market 1234", "OMV 1642 Satu Mare", "Pharmacy Green", "CORNER CAFE 55"],
      history,
    );

    expect(plan.rows.map((row) => row.kind)).toEqual(["unknown", "history", "rule", "unknown", "unknown"]);
    expect(plan.unknown).toEqual(["Corner Cafe", "Pharmacy Green"]);
    expect(plan.rows[0]).toEqual({ kind: "unknown", group: 0 });
    expect(plan.rows[4]).toEqual({ kind: "unknown", group: 0 });
  });

  it("applies the model's category only to the merchants nobody knew, and leaves rule rows to the database", () => {
    const plan = planCategories(["Corner Cafe", "Fresh Market 1234", "OMV 1642 Satu Mare", "Pharmacy Green"], history);

    const assigned = assignCategories(plan, (group) =>
      [{ category: "entertainment" as const, subtype: null }, { category: "health" as const, subtype: null }][group] ?? null);

    expect(assigned).toEqual([
      { category: "entertainment", subtype: null, source: "ai" },
      { category: "groceries", subtype: null, source: "history" },
      null,
      { category: "health", subtype: null, source: "ai" },
    ]);
  });

  it("drops a subtype the model gave to a category it doesn't belong to, and leaves a row without an answer to Other", () => {
    const plan = planCategories(["Corner Cafe", "Pharmacy Green"], new Map());

    const assigned = assignCategories(plan, (group) => (group === 0 ? { category: "health", subtype: "car_fuel" } : null));

    expect(assigned).toEqual([{ category: "health", subtype: null, source: "ai" }, null]);
  });

  it("groups merchants whose name is only digits by their text", () => {
    const plan = planCategories(["12345", "12345", "67890"], new Map());

    expect(plan.unknown).toEqual(["12345", "67890"]);
  });
});
