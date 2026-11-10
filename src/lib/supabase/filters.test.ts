import { describe, expect, it } from "vitest";

import { EXPENSE_CATEGORIES, EXPENSE_SUBTYPES } from "@/lib/expenses/categories";
import { escapeLikePattern, expenseSearchFilter, expenseTabMembershipFilter } from "@/lib/supabase/filters";

describe("expenseTabMembershipFilter", () => {
  it("builds the clause for categories, subtypes or both", () => {
    expect(expenseTabMembershipFilter(["car", "groceries"], [])).toBe("category.in.(car,groceries)");
    expect(expenseTabMembershipFilter([], ["car_fuel"])).toBe("subtype.in.(car_fuel)");
    expect(expenseTabMembershipFilter(["car"], ["car_fuel"])).toBe("category.in.(car),subtype.in.(car_fuel)");
  });

  it("accepts every key in the catalogue", () => {
    expect(() => expenseTabMembershipFilter(EXPENSE_CATEGORIES, EXPENSE_SUBTYPES)).not.toThrow();
  });

  it.each([
    ["a comma", ["car,id.not.is.null"], []],
    ["a closing parenthesis", ["car)"], []],
    ["a dot", ["car.x"], []],
    ["an unknown key", ["pets"], []],
    ["a category key in the subtype list", [], ["car"]],
    ["a subtype key in the category list", ["car_fuel"], []],
    ["a comma in a subtype", [], ["car_fuel),category.in.(car"]],
  ])("refuses %s", (_label, categories, subtypes) => {
    expect(() => expenseTabMembershipFilter(categories, subtypes)).toThrow(/Unknown expense (category|subtype) key/);
  });

  it("refuses non-string keys", () => {
    expect(() => expenseTabMembershipFilter([42 as never], [])).toThrow();
    expect(() => expenseTabMembershipFilter([null as never], [])).toThrow();
  });

  it("refuses two empty lists, which would select every expense", () => {
    expect(() => expenseTabMembershipFilter([], [])).toThrow("at least one");
  });
});

describe("escapeLikePattern", () => {
  it.each([
    ["plain text", "coffee", "coffee"],
    ["a percent sign", "100%", "100\\%"],
    ["an underscore", "a_b", "a\\_b"],
    ["a backslash", "a\\b", "a\\\\b"],
    ["a backslash before a percent sign", "\\%", "\\\\\\%"],
    ["all of them", "50%_off\\", "50\\%\\_off\\\\"],
    ["a star, which PostgREST turns into a percent sign", "a*b", "a_b"],
    ["a comma, parentheses and a dot, which are not special inside a value", "a,b(c).d", "a,b(c).d"],
    ["an empty string", "", ""],
  ])("escapes %s", (_label, input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected);
  });

  it("makes a pattern that matches only the literal text", () => {
    const toRegExp = (pattern: string) => {
      let source = "";
      for (let index = 0; index < pattern.length; index++) {
        const char = pattern[index];
        if (char === "\\") source += (pattern[++index] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        else if (char === "%") source += ".*";
        else if (char === "_") source += ".";
        else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      return new RegExp(`^${source}$`, "i");
    };
    const pattern = toRegExp(`%${escapeLikePattern("100%_")}%`);

    expect(pattern.test("paid 100%_ today")).toBe(true);
    expect(pattern.test("paid 1000 today")).toBe(false);
    expect(pattern.test("paid 100x today")).toBe(false);
  });
});

describe("expenseSearchFilter", () => {
  it("searches the description and the notes, ignoring case", () => {
    expect(expenseSearchFilter("lidl")).toBe('description.ilike."%lidl%",notes.ilike."%lidl%"');
  });

  it.each([
    ["a percent sign and an underscore", "50%_", 'description.ilike."%50\\\\%\\\\_%"'],
    ["a backslash", "a\\b", 'description.ilike."%a\\\\\\\\b%"'],
    ["a double quote", 'say "hi"', 'description.ilike."%say \\"hi\\"%"'],
    ["a comma, parentheses, a dot and a colon, inside the quotes", "a,b(c).d:e", 'description.ilike."%a,b(c).d:e%"'],
    ["a star, as one character", "a*b", 'description.ilike."%a_b%"'],
  ])("escapes %s and quotes the value", (_label, term, start) => {
    expect(expenseSearchFilter(term).startsWith(`${start},notes.ilike.`)).toBe(true);
  });

  it("adds the categories and subtypes whose label contains the text, by key", () => {
    expect(expenseSearchFilter("car")).toBe(
      'description.ilike."%car%",notes.ilike."%car%",category.in.(car),subtype.in.(car_maintenance,car_fuel,car_repairs)',
    );
    expect(expenseSearchFilter("ent")).toContain("category.in.(entertainment)");
  });

  it("adds the expenses without a subtype when the text is part of \"No subtype\"", () => {
    expect(expenseSearchFilter("no sub")).toBe('description.ilike."%no sub%",notes.ilike."%no sub%",subtype.is.null');
    expect(expenseSearchFilter("subtype")).toContain("subtype.is.null");
  });

  it("never lets the text add a clause of its own", () => {
    const filter = expenseSearchFilter('x",id.not.is.null,description.ilike."');

    expect(filter.startsWith('description.ilike."%x\\",id.not.is.null,description.ilike.\\"%"')).toBe(true);
  });
});
